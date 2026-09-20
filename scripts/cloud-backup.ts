import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import type { Comparison, ParsedDocument } from "../src/lib/domain/types";
import type { DocumentRecord, ExtractionRecord, RunRecord, State } from "../src/lib/server/contracts";
import { createSnapshotBackup, parseFlags, PersonalToolError, projectRoot, stringFlag, verifyBackup } from "./personal-tools";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const settled = new Set(["source_ready", "ready", "partial", "failed", "cancelled"]);
const stateLimit = 128 * 1024 * 1024;
export interface CloudBackupSnapshot {
  workspaceExists: boolean;
  comparisons: Comparison[];
  documents: DocumentRecord[];
  runs: RunRecord[];
  extractions: ExtractionRecord[];
  parsed: { documentId: string; record: ParsedDocument }[];
  checkpoints: { documentId: string; key: string; result: unknown }[];
  comparisonVersions: { comparisonId: string; version: number; snapshot: Comparison; createdAt: string }[];
}
export interface CloudBackupTransport {
  capture(ownerId: string): Promise<CloudBackupSnapshot>;
  readOriginal(document: DocumentRecord): Promise<Uint8Array>;
}
const fail = (message: string): never => { throw new PersonalToolError(message); };

// One PostgreSQL statement sees one MVCC snapshot. It selects no Auth, credentials,
// other-owner aggregates, deletion outbox or provider billing records.
export const snapshotSQL = `with captured as (
  select jsonb_build_object(
    'workspaceExists',exists(select 1 from public.workspaces w where w.owner_id=$1),
    'comparisons',coalesce((select jsonb_agg(c.snapshot order by c.id) from public.comparisons c where c.owner_id=$1 and c.deleted_at is null),'[]'),
    'documents',coalesce((select jsonb_agg(d.record order by d.id) from public.documents d join public.comparisons c on c.id=d.comparison_id and c.owner_id=d.owner_id where d.owner_id=$1 and d.deleted_at is null and c.deleted_at is null),'[]'),
    'runs',coalesce((select jsonb_agg(r.record order by r.id) from public.processing_runs r where r.owner_id=$1),'[]'),
    'extractions',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'documentId',e.document_id,'version',e.version,'quotation',e.quotation,'createdAt',e.created_at) order by e.id) from public.extraction_versions e where e.owner_id=$1),'[]'),
    'parsed',coalesce((select jsonb_agg(jsonb_build_object('documentId',p.document_id,'record',p.record) order by p.document_id) from public.parsed_documents p where p.owner_id=$1),'[]'),
    'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('documentId',a.document_id,'key',a.key,'result',a.result) order by a.document_id,a.key) from public.ai_checkpoints a where a.owner_id=$1),'[]'),
    'comparisonVersions',coalesce((select jsonb_agg(jsonb_build_object('comparisonId',v.comparison_id,'version',v.version,'snapshot',v.snapshot,'createdAt',v.created_at) order by v.comparison_id,v.version) from public.comparison_versions v where v.owner_id=$1),'[]')
  ) as snapshot
) select case when octet_length(snapshot::text)<=134217728 then snapshot else null end as snapshot from captured`;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(snapshot: CloudBackupSnapshot) { return createHash("sha256").update(stable(snapshot)).digest("hex"); }
function validateSnapshot(ownerId: string, snapshot: CloudBackupSnapshot) {
  if (!snapshot || !["comparisons", "documents", "runs", "extractions", "parsed", "checkpoints", "comparisonVersions"].every(key => Array.isArray(snapshot[key as keyof CloudBackupSnapshot]))) fail("The hosted snapshot is incomplete or exceeds the supported backup limit.");
  if (snapshot.workspaceExists !== true) fail("No hosted workspace exists for that owner UUID. No empty backup was published.");
  if (Buffer.byteLength(JSON.stringify(snapshot)) > stateLimit) fail("The hosted snapshot exceeds the portable backup limit.");
  const comparisons = new Map(snapshot.comparisons.map(c => [c.id, c]));
  const documents = new Map(snapshot.documents.map(d => [d.id, d]));
  if (comparisons.size !== snapshot.comparisons.length || documents.size !== snapshot.documents.length) fail("The hosted snapshot contains duplicate records.");
  for (const c of comparisons.values()) {
    if (!uuid.test(c.id) || c.workspaceId !== ownerId || c.isDemo || !Array.isArray(c.quotations) || !Array.isArray(c.corrections)) fail("The hosted snapshot contains an invalid owner or comparison.");
    for (const q of c.quotations) if (documents.get(q.documentId)?.comparisonId !== c.id) fail("A quotation is missing its preserved document. No recovery backup was published.");
  }
  for (const d of documents.values()) {
    if (d.status === "uploading") fail("An upload is unfinished. Finish or delete it in FieldOps before backing up.");
    if (d.status !== "uploaded" || d.ownerId !== ownerId || !uuid.test(d.id) || d.storagePath !== `${ownerId}/${d.id}` || !comparisons.has(d.comparisonId)) fail("The hosted snapshot contains an invalid source or owner.");
  }
  for (const r of snapshot.runs) {
    if (!settled.has(r.stage) || (r.leaseUntil && Date.parse(r.leaseUntil) > Date.now())) fail("Processing is active or waiting for quota. Finish or cancel every job before backing up.");
    if (!uuid.test(r.id) || r.ownerId !== ownerId || documents.get(r.documentId)?.comparisonId !== r.comparisonId) fail("A processing record does not belong to the captured workspace.");
  }
  for (const e of snapshot.extractions) if (!uuid.test(e.id) || !documents.has(e.documentId) || e.quotation.documentId !== e.documentId) fail("An extraction record is missing its original source.");
  for (const p of snapshot.parsed) if (!documents.has(p.documentId) || p.record.documentId !== p.documentId) fail("Parsed evidence is missing its original source.");
  for (const a of snapshot.checkpoints) if (!documents.has(a.documentId) || typeof a.key !== "string") fail("A processing checkpoint is missing its original source.");
  for (const v of snapshot.comparisonVersions) if (!comparisons.has(v.comparisonId) || v.snapshot.id !== v.comparisonId || v.snapshot.workspaceId !== ownerId) fail("A saved comparison version does not belong to the captured workspace.");
}

export async function createCloudBackup(ownerId: string, destination: string, transport: CloudBackupTransport) {
  if (!uuid.test(ownerId)) fail("--owner must be the managed Auth user's UUID, not a GitHub numeric account ID.");
  // Freeze the capture even when an injected transport reuses mutable objects.
  const snapshot: CloudBackupSnapshot = structuredClone(await transport.capture(ownerId));
  validateSnapshot(ownerId, snapshot); const digest = fingerprint(snapshot);
  const state: State = {
    version: 1, comparisons: {}, documents: {}, runs: {}, extractions: {}, parsed: {}, checkpoints: {}, deletionOutbox: [],
    cloudRecoveryArchive: { format: 1, capturedAt: new Date().toISOString(), ownerId, snapshotSha256: digest, comparisonVersions: snapshot.comparisonVersions },
  };
  for (const c of snapshot.comparisons) state.comparisons[c.id] = { ownerId: "local-user", comparison: { ...c, workspaceId: "local-workspace", quotations: c.quotations.map(q => ({ ...q, sourceUrl: `/api/documents/${q.documentId}/source` })) } };
  for (const d of snapshot.documents) state.documents[d.id] = { ...d, ownerId: "local-user", storagePath: `local-user/${d.id}` };
  for (const r of snapshot.runs) {
    const local = { ...r, ownerId: "local-user" }; delete local.taskRunId; delete local.dispatchedAt; delete local.leaseUntil;
    state.runs[r.id] = local;
  }
  for (const e of snapshot.extractions) state.extractions[e.id] = { ...e, quotation: { ...e.quotation, sourceUrl: `/api/documents/${e.documentId}/source` } };
  for (const p of snapshot.parsed) state.parsed[p.documentId] = p.record;
  for (const a of snapshot.checkpoints) state.checkpoints![`${a.documentId}:${a.key}`] = a.result;
  const originals = new Map(snapshot.documents.map(d => [d.id, d]));
  const manifest = await createSnapshotBackup(state, destination, local => transport.readOriginal(originals.get(local.id)!), async () => {
    const current = await transport.capture(ownerId); validateSnapshot(ownerId, current);
    if (fingerprint(current) !== digest) fail("The hosted workspace changed while copying. The backup remains incomplete; wait for work to settle and retry into a new directory.");
  });
  await verifyBackup(destination); return manifest;
}

async function ignoredPath(input: string, mustExist: boolean) {
  const path = resolve(projectRoot, input), rel = relative(projectRoot, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("Use an ignored path inside this FieldOps repository.");
  try { await promisify(execFile)("git", ["check-ignore", "--quiet", "--", rel], { cwd: projectRoot }); }
  catch { fail("The configuration and backup destination must be ignored by this repository's Git rules."); }
  let current = projectRoot;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    try { const info = await lstat(current); if (info.isSymbolicLink()) fail("Configuration and destination paths must not contain symbolic links."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  try {
    const info = await lstat(path);
    if (!mustExist) fail("The destination already exists. Choose a fresh ignored directory; existing data is never overwritten.");
    if (!info.isFile() || info.size > 65536) fail("Use a regular ignored environment file of at most 64 KiB.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; if (mustExist) fail("The ignored environment file is missing."); }
  return path;
}
export async function main(args = process.argv.slice(2)) {
  const flags = parseFlags(args, ["owner", "env-file", "to", "help"]);
  if (flags.help) { console.log("npx tsx scripts/cloud-backup.ts --owner=AUTH-USER-UUID --env-file=.env.fieldops.production.local --to=.fieldops/backups/NEW-NAME\nRead-only hosted backup for local recovery. Refuses unfinished work and existing destinations. Copies private originals and state; no model calls, cloud uploads, encryption, or cloud restore."); return; }
  const owner = stringFlag(flags, "owner"); if (!uuid.test(owner)) fail("--owner must be a managed Auth user UUID.");
  const envFile = await ignoredPath(stringFlag(flags, "env-file"), true), destination = await ignoredPath(stringFlag(flags, "to"), false);
  const settings = parseEnv(await readFile(envFile, "utf8"));
  const keys = ["FIELDOPS_DATABASE_URL", "NEON_STORAGE_ENDPOINT", "NEON_STORAGE_ACCESS_KEY_ID", "NEON_STORAGE_SECRET_ACCESS_KEY", "NEON_STORAGE_REGION", "NEON_STORAGE_BUCKET"] as const;
  for (const key of keys) {
    if (key !== "NEON_STORAGE_BUCKET" && !settings[key]) fail("The explicit environment file is missing the restricted database URL or private storage settings. Inherited credentials are not used.");
    process.env[key] = settings[key] || "quotations";
  }
  const { sqlQuery } = await import("../src/lib/server/neon-db");
  const { storageRead } = await import("../src/lib/server/neon-storage");
  const manifest = await createCloudBackup(owner, destination, {
    capture: async ownerId => (await sqlQuery<{ snapshot: CloudBackupSnapshot }>(snapshotSQL, [ownerId]))[0]?.snapshot,
    readOriginal: storageRead,
  });
  console.log(`Hosted backup verified: ${manifest.comparisons} comparisons and ${manifest.documents} originals.\nRestore it into a NEW local directory using personal:restore. Cloud data was not changed.\nThe ignored destination contains unencrypted private data; keep it private.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error instanceof PersonalToolError ? error.message : "Hosted backup failed. No cloud data was changed. Any partial destination remains incomplete; inspect configuration and retry into a new directory.");
  process.exitCode = 1;
});
