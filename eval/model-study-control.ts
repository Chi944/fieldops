import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { DevelopmentEvent } from "./development-control";

export const MODEL_STUDY_DAILY_LIMIT = 180000;
export const MODEL_STUDY_METRIC_VERSION = "fieldops-model-study-2-fixed-unattempted";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const safeName = /^[a-z][a-z0-9-]{2,63}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const dayOf = (at: string) => { if (!Number.isFinite(Date.parse(at))) throw new Error("Invalid shared-budget timestamp."); return new Date(at).toISOString().slice(0, 10); };
type Entry = { kind: "seed" | "allocation" | "activity" | "blocked"; at: string; id: string; tokens?: number; source?: string; line?: number; eventHash?: string; phaseIdentity?: string };
type Seed = { id: string; at: string; tokens: number; source: string; line: number; eventHash: string };
export interface StudyBudgetSnapshot { utcDay: string; ceiling: number; committedEstimatedTokens: number; remainingEstimatedTokens: number; fullPhaseAllocation: number; fullPairFits: boolean; phaseFits: boolean; scope: string }
function metadataJson<T>(text: string): T { try { return JSON.parse(text) as T; } catch { throw new Error("Malformed shared budget metadata; no dispatch permitted."); } }

function parseEntries(text: string): Entry[] {
  const entries = text.split("\n").filter(Boolean).map(line => metadataJson<Entry>(line));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!["seed", "allocation", "activity", "blocked"].includes(entry.kind) || !hashPattern.test(entry.id) || !Number.isFinite(Date.parse(entry.at))) throw new Error("Malformed shared budget ledger; no dispatch permitted.");
    if (["seed", "allocation"].includes(entry.kind)) {
      if (!Number.isSafeInteger(entry.tokens) || entry.tokens! < 1 || ids.has(entry.id)) throw new Error("Duplicate or malformed shared budget reservation.");
      ids.add(entry.id);
    }
  }
  return entries;
}
async function readOptional(filename: string) { try { if (await realpath(filename) !== filename) throw new Error("Shared budget metadata must not redirect."); return await readFile(filename, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; } }
async function exactDirectory(directory: string) { await mkdir(directory, { recursive: true }); if (await realpath(directory) !== directory) throw new Error("Shared budget paths must not redirect."); }

/** Reads usage metadata only. Rejected bodies, quotation outputs and held-out data are never opened. */
async function journalSeeds(base: string, entries: Entry[]): Promise<{ seeds: Seed[]; latest?: string }> {
  const seeds: Seed[] = []; let latest: string | undefined;
  const seenEvents = new Map<string, string>();
  const allocations = new Map(entries.filter(entry => entry.kind === "allocation").map(entry => [entry.id, entry]));
  const allocatedUsage = new Map<string, number>();
  for (const directory of await readdir(base, { withFileTypes: true })) {
    if (!safeName.test(directory.name)) continue;
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Invalid development journal directory.");
    for (const phase of ["live-before", "live-after"]) {
      const filename = path.join(base, directory.name, phase, "usage.jsonl");
      const text = await readOptional(filename);
      if (!text) continue;
      if (await realpath(filename) !== filename) throw new Error("Development journals must not redirect.");
      const source = sha(`${directory.name}/${phase}/usage.jsonl`);
      const lines = text.split("\n").filter(Boolean);
      for (let index = 0; index < lines.length; index++) {
        const event = metadataJson<DevelopmentEvent>(lines[index]);
        if (!["reservation", "response", "failure", "rejection", "quota_wait"].includes(event.kind)) throw new Error("Malformed development usage journal.");
        dayOf(event.at);
        if (["reservation", "response", "failure"].includes(event.kind) && (!latest || Date.parse(event.at) > Date.parse(latest))) latest = event.at;
        if (event.kind !== "reservation") continue;
        if (!Number.isSafeInteger(event.reservedTokens) || event.reservedTokens! < 1 || !Number.isSafeInteger(event.attemptSlots) || event.attemptSlots! < 1) throw new Error("Malformed development reservation.");
        const eventHash = sha(lines[index]);
        if (seenEvents.has(eventHash)) throw new Error("Duplicate development reservation metadata requires review; no dispatch permitted.");
        seenEvents.set(eventHash, source);
        if (event.sharedAllocationId) {
          const allocation = allocations.get(event.sharedAllocationId);
          if (!allocation || allocation.phaseIdentity !== sha(`${directory.name}/${phase}`) || dayOf(event.at) !== dayOf(allocation.at)) throw new Error("An existing reservation has no matching shared allocation.");
          allocatedUsage.set(allocation.id, (allocatedUsage.get(allocation.id) ?? 0) + event.reservedTokens!);
          continue;
        }
        seeds.push({ id: sha(`${source}:${index}`), at: event.at, tokens: event.reservedTokens!, source, line: index, eventHash });
      }
    }
  }
  for (const [id, tokens] of allocatedUsage) if (tokens > allocations.get(id)!.tokens!) throw new Error("Shared allocation was exceeded in an existing journal.");
  for (const entry of entries.filter(entry => entry.kind === "seed")) {
    const current = seeds.find(seed => seed.id === entry.id);
    if (!current || current.eventHash !== entry.eventHash || current.tokens !== entry.tokens || current.at !== entry.at) throw new Error("Previously seeded reservation metadata changed or disappeared.");
  }
  return { seeds, latest };
}
function snapshot(entries: Entry[], now: number, allocation: number): StudyBudgetSnapshot {
  const utcDay = new Date(now).toISOString().slice(0, 10);
  const committedEstimatedTokens = entries.filter(entry => ["seed", "allocation"].includes(entry.kind) && dayOf(entry.at) === utcDay).reduce((total, entry) => total + entry.tokens!, 0);
  const remainingEstimatedTokens = Math.max(0, MODEL_STUDY_DAILY_LIMIT - committedEstimatedTokens);
  return { utcDay, ceiling: MODEL_STUDY_DAILY_LIMIT, committedEstimatedTokens, remainingEstimatedTokens, fullPhaseAllocation: allocation, fullPairFits: allocation * 2 <= remainingEstimatedTokens, phaseFits: allocation <= remainingEstimatedTokens, scope: "Shared local estimated reservations across development journals and both models; unknown/interrupted usage is never refunded. This does not measure provider/account quota or other applications." };
}
export async function inspectModelStudyBudget(root: string, allocation = 60000, now = Date.now()): Promise<StudyBudgetSnapshot> {
  const base = path.join(root, "eval/runs/private/development");
  const entries = parseEntries(await readOptional(path.join(base, "_model-study", "ledger.jsonl")));
  const { seeds } = await journalSeeds(base, entries);
  const existing = new Set(entries.map(entry => entry.id));
  return snapshot([...entries, ...seeds.filter(seed => !existing.has(seed.id)).map(seed => ({ kind: "seed" as const, ...seed }))], now, allocation);
}

/** Exclusive across both models. Admission reserves the entire phase, not just its first request. */
export async function acquireModelStudyBudget(options: { root: string; name: string; phase: "before" | "after"; configurationHash: string; allocationTokens: number; now?: () => number }) {
  if (!safeName.test(options.name) || !hashPattern.test(options.configurationHash) || !Number.isSafeInteger(options.allocationTokens) || options.allocationTokens < 1 || options.allocationTokens > 60000) throw new Error("Invalid fixed model-study allocation.");
  const now = options.now ?? Date.now;
  const base = path.join(options.root, "eval/runs/private/development"), directory = path.join(base, "_model-study");
  await exactDirectory(base); await exactDirectory(directory);
  const lockPath = path.join(directory, "run.lock");
  let lock;
  try { lock = await open(lockPath, "wx"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A shared model study is active or interrupted. Verify its process before clearing its lock."); throw error; }
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await lock.close(); await unlink(lockPath); } };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date(now()).toISOString() })); await lock.sync();
    const filename = path.join(directory, "ledger.jsonl");
    const entries = parseEntries(await readOptional(filename));
    const append = async (entry: Entry) => { const handle = await open(filename, "a"); try { await handle.writeFile(`${JSON.stringify(entry)}\n`); await handle.sync(); entries.push(entry); } finally { await handle.close(); } };
    const { seeds, latest } = await journalSeeds(base, entries);
    const existing = new Set(entries.map(entry => entry.id));
    for (const seed of seeds) if (!existing.has(seed.id)) await append({ kind: "seed", ...seed });
    let lastActivity = [...entries.filter(entry => entry.kind === "activity").map(entry => entry.at), ...(latest ? [latest] : [])].sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    const phaseIdentity = sha(`${options.name}/live-${options.phase}`);
    let allocation: Entry;
    const admission = snapshot(entries, now(), options.allocationTokens);
    const admit = async () => {
      const at = new Date(now()).toISOString(), id = sha(`${phaseIdentity}:${options.configurationHash}:${dayOf(at)}`);
      const previous = entries.find(entry => entry.kind === "allocation" && entry.id === id);
      if (previous) { if (previous.tokens !== options.allocationTokens) throw new Error("The resumed shared allocation changed."); allocation = previous; return; }
      const current = snapshot(entries, now(), options.allocationTokens);
      if (!current.phaseFits) {
        await append({ kind: "blocked", at, id: sha(`${id}:${at}`), phaseIdentity });
        throw Object.assign(new Error("The complete model-study phase does not fit the shared UTC-day budget. No request was sent; resume the same phase after reset."), { code: "model_study_daily_budget", budget: current });
      }
      allocation = { kind: "allocation", at, id, tokens: options.allocationTokens, phaseIdentity };
      await append(allocation);
    };
    await admit();
    return {
      admission,
      lastActivity: () => lastActivity,
      annotate: async (event: DevelopmentEvent): Promise<DevelopmentEvent> => {
        if (event.kind === "reservation") {
          if (dayOf(allocation.at) !== dayOf(event.at)) await admit();
          event = { ...event, sharedAllocationId: allocation.id };
        }
        if (["reservation", "response", "failure"].includes(event.kind)) { lastActivity = event.at; await append({ kind: "activity", at: event.at, id: allocation.id }); }
        return event;
      },
      current: () => snapshot(entries, now(), options.allocationTokens),
      close,
    };
  } catch (error) { await close(); throw error; }
}

export function assertComparableModelConfigurations(before: Record<string, unknown>, after: Record<string, unknown>): void {
  const normalize = (configuration: Record<string, unknown>) => Object.fromEntries(Object.entries(configuration).filter(([key]) => !["sha256", "model", "modelProfile"].includes(key)));
  const models = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
  if (!models.includes(String(before.model)) || !models.includes(String(after.model)) || before.model === after.model || JSON.stringify(normalize(before)) !== JSON.stringify(normalize(after))) throw new Error("Model comparison requires distinct allowlisted models and otherwise identical pipeline, runtime, policy and files.");
}
