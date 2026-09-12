import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { State, DocumentRecord } from "../src/lib/server/contracts";
import { LIMITS } from "../src/lib/domain/types";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const personalDirectory = join(projectRoot, ".fieldops", "personal");
export const incompleteMarker = ".fieldops-incomplete";
const sessionName = "personal-session.lock";
const stateLimit = 128 * 1024 * 1024;
const manifestLimit = 16 * 1024 * 1024;
const objectPattern = /^objects\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
const digestPattern = /^[a-f0-9]{64}$/;
type FileEntry = { path: string; size: number; sha256: string };
export type BackupManifest = { format: "fieldops-private-backup"; version: 1; createdAt: string; stateVersion: 1; comparisons: number; documents: number; files: FileEntry[] };
export class PersonalToolError extends Error { constructor(message: string) { super(message); this.name = "PersonalToolError"; } }
const fail = (message: string): never => { throw new PersonalToolError(message); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exists = async (path: string) => { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } };

export function privateChildEnvironment(directory: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...inherited, NODE_ENV: "development", FIELDOPS_LOCAL_MODE: "true", FIELDOPS_PERSONAL_MODE: "true", FIELDOPS_PROCESSING_MODE: "parse_only", FIELDOPS_DATA_DIR: resolve(directory), FIELDOPS_OCR_DATA_DIR: join(projectRoot, ".fieldops", "tessdata"),
    GROQ_API_KEY: "", GROQ_FREE_TIER_CONFIRMED: "false", GROQ_ZDR_CONFIRMED: "false", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    DATABASE_URL: "", DATABASE_URL_UNPOOLED: "", FIELDOPS_DATABASE_URL: "", NEON_AUTH_BASE_URL: "", NEON_AUTH_COOKIE_SECRET: "", VITE_NEON_AUTH_URL: "", NEON_PROJECT_ID: "",
    NEON_STORAGE_ENDPOINT: "", NEON_STORAGE_ACCESS_KEY_ID: "", NEON_STORAGE_SECRET_ACCESS_KEY: "", NEON_STORAGE_REGION: "", NEON_STORAGE_BUCKET: "",
    PGHOST: "", PGUSER: "", PGPASSWORD: "", POSTGRES_URL: "", POSTGRES_URL_NON_POOLING: "", POSTGRES_PRISMA_URL: "", POSTGRES_PASSWORD: "",
    TRIGGER_PROJECT_ID: "", TRIGGER_SECRET_KEY: "", FIELDOPS_SITE_URL: "", NEXT_TELEMETRY_DISABLED: "1", VERCEL: "", RENDER: "", AWS_LAMBDA_FUNCTION_NAME: "" };
}

/** AI is opt-in; import only model settings from a dedicated ignored file. */
export function personalAIEnvironment(base: NodeJS.ProcessEnv, contents: string): NodeJS.ProcessEnv {
  const settings = parseEnv(contents);
  if (!settings.GROQ_API_KEY || settings.GROQ_FREE_TIER_CONFIRMED !== "true" || settings.GROQ_ZDR_CONFIRMED !== "true") fail("AI setup is incomplete. Configure GROQ_API_KEY and verify Free Plan and inference Zero Data Retention in .env.ai.local.");
  const model = settings.GROQ_MODEL || "openai/gpt-oss-120b";
  if (!["openai/gpt-oss-120b", "openai/gpt-oss-20b"].includes(model)) fail("Choose a supported Groq Free structured-output model in .env.ai.local.");
  return { ...base, FIELDOPS_PROCESSING_MODE: "ai", GROQ_API_KEY: settings.GROQ_API_KEY, GROQ_MODEL: model, GROQ_FREE_TIER_CONFIRMED: "true", GROQ_ZDR_CONFIRMED: "true" };
}

export function parseFlags(args: string[], allowed: readonly string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index++) {
    const raw = args[index]; if (!raw.startsWith("--")) fail("Use named options; run this command with --help for examples.");
    const [name, ...rest] = raw.slice(2).split("=");
    if (!allowed.includes(name) || name in flags) fail("An option is unknown or repeated. Run this command with --help.");
    const value = rest.length ? rest.join("=") : args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
    flags[name] = value;
  }
  return flags;
}
export function stringFlag(flags: Record<string, string | true>, name: string, fallback?: string): string {
  const value = flags[name] ?? fallback; if (typeof value === "string" && value.trim()) return value; return fail(`--${name} requires a value.`);
}
export function backupName(prefix = "backup") { return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`; }

export async function availablePort(requested?: number): Promise<number> {
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 3001 || requested > 3009)) fail("Choose a loopback port from 3001 to 3009. Port 3000 is never used.");
  for (const port of requested === undefined ? Array.from({ length: 9 }, (_, i) => 3001 + i) : [requested]) {
    const free = await new Promise<boolean>((done, reject) => {
      const server = createServer();
      server.once("error", error => { if (["EADDRINUSE", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) done(false); else reject(error); });
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => done(true)));
    });
    if (free) return port;
  }
  return fail(requested ? "That loopback port is occupied. No process was stopped; choose another port or omit --port." : "Loopback ports 3001–3009 are occupied. No process was stopped; close your own FieldOps session and retry.");
}

async function regularFile(root: string, path: string, maxBytes = Number.MAX_SAFE_INTEGER) {
  if (path !== "state.json" && path !== "manifest.json" && !objectPattern.test(path)) fail("The backup contains an invalid file path.");
  let target = resolve(root);
  const rootInfo = await lstat(target); if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("Use a real directory, not a symbolic link.");
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index++) {
    target = join(target, parts[index]); const info = await lstat(target);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) fail("Backup paths must contain regular files and directories, not symbolic links.");
    if (index === parts.length - 1 && info.size > maxBytes) fail("A backup file exceeds the supported size limit.");
  }
  return target;
}
async function fileEntry(root: string, path: string, maxBytes?: number): Promise<FileEntry> {
  const target = await regularFile(root, path, maxBytes); const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(target)) { hash.update(chunk); size += chunk.length; if (maxBytes !== undefined && size > maxBytes) fail("A backup file exceeds the supported size limit."); }
  return { path, size, sha256: hash.digest("hex") };
}
async function writeNewFile(path: string, bytes: string | Uint8Array) {
  const handle = await open(path, "wx", 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
function separated(source: string, destination: string) {
  const inside = (a: string, b: string) => { const rel = relative(resolve(a), resolve(b)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
  if (inside(source, destination) || inside(destination, source)) fail("Source and destination directories must be separate; neither may contain the other.");
}
async function newDirectory(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("The destination already exists. Choose a new directory; existing data is never overwritten."); throw error; }
  await writeNewFile(join(path, incompleteMarker), "Incomplete FieldOps operation. Do not launch or restore this directory.\n");
}

function parseState(bytes: string): State {
  let candidate: unknown; try { candidate = JSON.parse(bytes); } catch { return fail("Saved state is not valid JSON. No backup or restore was published."); }
  if (!record(candidate) || candidate.version !== 1 || !["comparisons", "documents", "runs", "extractions", "parsed"].every(key => record(candidate[key])) || !Array.isArray(candidate.deletionOutbox) || (candidate.checkpoints !== undefined && !record(candidate.checkpoints))) fail("Saved state has an unsupported or incomplete format.");
  const state = candidate as unknown as State;
  for (const value of Object.values(state.comparisons)) if (!record(value) || typeof value.ownerId !== "string" || !record(value.comparison) || typeof value.comparison.id !== "string" || !Array.isArray(value.comparison.quotations) || !Array.isArray(value.comparison.corrections)) fail("A saved comparison is invalid.");
  for (const document of Object.values(state.documents)) {
    if (!record(document) || typeof document.id !== "string" || typeof document.ownerId !== "string" || typeof document.comparisonId !== "string" || typeof document.storagePath !== "string" || !objectPattern.test(`objects/${document.storagePath}`) || !Number.isSafeInteger(document.size) || document.size < 0 || document.size > LIMITS.fileBytes || !["uploaded", "uploading", "deleted"].includes(document.status)) fail("A saved document record is invalid.");
    if (document.status === "uploading") fail("An upload is unfinished. Finish or remove it before backing up this workspace.");
    if (document.status === "uploaded" && (!digestPattern.test(document.contentHash) || !state.comparisons[document.comparisonId] || state.comparisons[document.comparisonId].ownerId !== document.ownerId)) fail("A saved original has no valid hash or owning comparison.");
  }
  return state;
}
function documents(state: State): DocumentRecord[] { return Object.values(state.documents).filter(document => document.status === "uploaded"); }
async function readState(directory: string): Promise<{ state: State; bytes: Buffer }> {
  if (await exists(join(directory, incompleteMarker))) fail("This directory contains an incomplete backup/restore. Use a completed backup and a new destination.");
  const bytes = await readFile(await regularFile(directory, "state.json", stateLimit)); return { bytes, state: parseState(bytes.toString("utf8")) };
}

async function lock(directory: string, name: string, extra: Record<string, unknown> = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, name);
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A dead process may leave a lock after power loss. Never remove a live or unreadable lock.
    const info = await lstat(lockPath); if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return fail("A workspace lock needs manual inspection. No lock was removed.");
    let owner: unknown; try { owner = JSON.parse(await readFile(lockPath, "utf8")); } catch { return fail("A workspace lock is unreadable. Stop FieldOps and inspect the lock before retrying."); }
    if (!record(owner) || !Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0) return fail("A workspace lock is invalid. No lock was removed.");
    try { process.kill(Number(owner.pid), 0); return fail("The workspace is in use. Stop its FieldOps session before retrying."); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; }
    await unlink(lockPath); handle = await open(lockPath, "wx", 0o600);
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now(), ...extra })); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(lockPath); throw error; }
  return async () => { await handle.close(); await unlink(lockPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); };
}
export async function acquireSession(directory: string, port: number) { return lock(resolve(directory), sessionName, { port }); }

export async function createBackup(source: string, destination: string): Promise<BackupManifest> {
  source = resolve(source); destination = resolve(destination); separated(source, destination);
  await readState(source); // Never turn a misspelled/nonexistent source into an empty backup.
  const releaseSession = await lock(source, sessionName);
  try {
    const releaseState = await lock(source, "state.lock");
    try {
      const { state, bytes } = await readState(source);
      await newDirectory(destination);
      const files: FileEntry[] = [];
      for (const document of documents(state)) {
        const path = `objects/${document.storagePath}`;
        const sourceFile = await regularFile(source, path, LIMITS.fileBytes);
        const target = join(destination, ...path.split("/")); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(sourceFile, target, constants.COPYFILE_EXCL);
        const entry = await fileEntry(destination, path, LIMITS.fileBytes);
        if (entry.sha256 !== document.contentHash || entry.size !== document.size) fail("A private original does not match its saved hash or size. The incomplete backup was retained for inspection.");
        files.push(entry);
      }
      await writeNewFile(join(destination, "state.json"), bytes); files.unshift(await fileEntry(destination, "state.json", stateLimit));
      const manifest: BackupManifest = { format: "fieldops-private-backup", version: 1, createdAt: new Date().toISOString(), stateVersion: 1, comparisons: Object.keys(state.comparisons).length, documents: documents(state).length, files };
      await writeNewFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2));
      await unlink(join(destination, incompleteMarker)); return manifest;
    } finally { await releaseState(); }
  } finally { await releaseSession(); }
}

export async function verifyBackup(source: string): Promise<{ manifest: BackupManifest; state: State }> {
  source = resolve(source); if (await exists(join(source, incompleteMarker))) fail("This backup is incomplete and cannot be restored.");
  let candidate: unknown;
  try { candidate = JSON.parse(await readFile(await regularFile(source, "manifest.json", manifestLimit), "utf8")); } catch (error) { if (error instanceof PersonalToolError) throw error; return fail("The backup manifest is missing or invalid."); }
  if (!record(candidate) || candidate.format !== "fieldops-private-backup" || candidate.version !== 1 || candidate.stateVersion !== 1 || typeof candidate.createdAt !== "string" || !Array.isArray(candidate.files) || candidate.files.length < 1 || candidate.files.length > 100001) fail("The backup manifest has an unsupported format.");
  const manifest = candidate as unknown as BackupManifest; const paths = new Set<string>();
  for (const entry of manifest.files) {
    if (!record(entry) || typeof entry.path !== "string" || (entry.path !== "state.json" && !objectPattern.test(entry.path)) || paths.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.sha256 !== "string" || !digestPattern.test(entry.sha256)) fail("The backup manifest contains an invalid or duplicate file entry.");
    paths.add(entry.path);
    const actual = await fileEntry(source, entry.path, entry.path === "state.json" ? stateLimit : LIMITS.fileBytes);
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256) fail("Backup integrity verification failed. A file is missing, changed or damaged.");
  }
  if (!paths.has("state.json")) fail("The backup has no saved workspace state.");
  const { state } = await readState(source); const active = documents(state);
  if (paths.size !== active.length + 1 || manifest.documents !== active.length || manifest.comparisons !== Object.keys(state.comparisons).length) fail("The manifest does not match its workspace state.");
  for (const document of active) { const entry = manifest.files.find(file => file.path === `objects/${document.storagePath}`); if (!entry || entry.sha256 !== document.contentHash || entry.size !== document.size) fail("An original is missing from the backup or does not match its document record."); }
  return { manifest, state };
}

export async function restoreBackup(source: string, destination: string): Promise<BackupManifest> {
  source = resolve(source); destination = resolve(destination); separated(source, destination);
  if (await exists(destination)) fail("The destination already exists. Choose a new directory; existing data is never overwritten.");
  const { manifest } = await verifyBackup(source); await newDirectory(destination);
  // Copy sources first; publish the verified state last. A failure keeps the incomplete marker.
  for (const entry of [...manifest.files].sort((a, b) => Number(a.path === "state.json") - Number(b.path === "state.json"))) {
    const original = await regularFile(source, entry.path); const target = join(destination, ...entry.path.split("/"));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await copyFile(original, target, constants.COPYFILE_EXCL);
    const copied = await fileEntry(destination, entry.path, entry.path === "state.json" ? stateLimit : LIMITS.fileBytes);
    if (copied.sha256 !== entry.sha256 || copied.size !== entry.size) fail("The backup changed during restoration. The destination remains marked incomplete.");
  }
  await writeNewFile(join(destination, "restored-backup.json"), JSON.stringify({ restoredAt: new Date().toISOString(), backupCreatedAt: manifest.createdAt, manifestSha256: createHash("sha256").update(await readFile(join(source, "manifest.json"))).digest("hex") }, null, 2));
  await unlink(join(destination, incompleteMarker)); return manifest;
}

export async function preflight(directory: string, requestedPort?: number) {
  const checks: { name: string; ok: boolean; required: boolean; detail: string }[] = [];
  const nodeOk = Number(process.versions.node.split(".")[0]) === 24;
  checks.push({ name: "Node runtime", ok: nodeOk, required: true, detail: nodeOk ? `Node ${process.versions.node}` : "Install Node.js 24, then run npm ci." });
  const dependencies = await exists(join(projectRoot, "node_modules", "next", "dist", "bin", "next"));
  checks.push({ name: "Application dependencies", ok: dependencies, required: true, detail: dependencies ? "Installed locally; no package download will run automatically." : "Run npm ci in the FieldOps repository." });
  let stateOk = true, detail = "New personal workspace; created only when you launch.";
  if (await exists(directory)) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) { stateOk = false; detail = "Choose a real directory, not a file or symbolic link."; }
    else if (await exists(join(directory, incompleteMarker))) { stateOk = false; detail = "An incomplete restore is present. Use a completed backup and a fresh destination."; }
    else if (await exists(join(directory, "state.json"))) { try { await readState(directory); detail = "Saved workspace structure is readable; this check does not hash private originals."; } catch { stateOk = false; detail = "Saved workspace state is invalid or unfinished. Inspect it before launch."; } }
    else detail = "Personal directory exists; no comparisons have been saved.";
  }
  checks.push({ name: "Private local persistence", ok: stateOk, required: true, detail });
  checks.push({ name: "Live AI", ok: true, required: true, detail: "Disabled for this launcher, including keys inherited from the shell or .env.local." });
  const ocr = await exists(join(projectRoot, ".fieldops", "tessdata", "eng.traineddata.gz"));
  checks.push({ name: "English OCR asset", ok: ocr, required: false, detail: ocr ? "Installed in this FieldOps repository; no document is sent to an OCR service." : "Optional for text PDFs/CSV/XLSX. For scans, run npx tsx scripts/process.ts --prepare-ocr." });
  let port: number | undefined;
  try { port = await availablePort(requestedPort); checks.push({ name: "Loopback port", ok: true, required: true, detail: `http://127.0.0.1:${port} — no external interface, no use of port 3000.` }); }
  catch (error) { checks.push({ name: "Loopback port", ok: false, required: true, detail: error instanceof PersonalToolError ? error.message : "Loopback availability could not be checked." }); }
  return { ready: checks.every(check => !check.required || check.ok), mode: "local" as const, aiEnabled: false as const, port, checks };
}

export function reportFailure(error: unknown) {
  console.error(error instanceof PersonalToolError ? error.message : `Local operation failed${(error as NodeJS.ErrnoException)?.code ? ` (${(error as NodeJS.ErrnoException).code})` : ""}. No existing destination was overwritten. Inspect the command options and try again.`);
  process.exitCode = 1;
}
