import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { accountedDevelopmentTokens, type DevelopmentEvent } from "./development-control";

export const MODEL_STUDY_DAILY_LIMIT = 180000;
export const MODEL_STUDY_METRIC_VERSION = "fieldops-model-study-2-fixed-unattempted";
export const MODEL_STUDY_PROTOCOL_VERSION = 2;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const safeName = /^[a-z][a-z0-9-]{2,63}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const dayOf = (at: string) => { if (!Number.isFinite(Date.parse(at))) throw new Error("Invalid shared-budget timestamp."); return new Date(at).toISOString().slice(0, 10); };
type Entry = { kind: "seed" | "allocation" | "activity" | "blocked" | "known_usage" | "usage_floor"; at: string; id: string; tokens?: number; source?: string; line?: number; eventHash?: string; phaseIdentity?: string };
type Seed = { id: string; at: string; tokens: number; source: string; line: number; eventHash: string };
export interface StudyBudgetSnapshot { utcDay: string; ceiling: number; committedEstimatedTokens: number; remainingEstimatedTokens: number; fullPhaseAllocation: number; fullPairFits: boolean; phaseFits: boolean; scope: string }
function metadataJson<T>(text: string): T { try { return JSON.parse(text) as T; } catch { throw new Error("Malformed shared budget metadata; no dispatch permitted."); } }

function parseEntries(text: string): Entry[] {
  const entries = text.split("\n").filter(Boolean).map(line => metadataJson<Entry>(line));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!["seed", "allocation", "activity", "blocked", "known_usage", "usage_floor"].includes(entry.kind) || !hashPattern.test(entry.id) || !Number.isFinite(Date.parse(entry.at))) throw new Error("Malformed shared budget ledger; no dispatch permitted.");
    if (["known_usage", "usage_floor"].includes(entry.kind) && (!Number.isSafeInteger(entry.tokens) || entry.tokens! < 0 || !hashPattern.test(entry.phaseIdentity ?? ""))) throw new Error("Malformed known-usage floor.");
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
async function journalSeeds(base: string, entries: Entry[]): Promise<{ seeds: Seed[]; known: Entry[]; latest?: string }> {
  const seeds: Seed[] = []; let latest: string | undefined;
  const seenEvents = new Map<string, string>();
  const allocations = new Map(entries.filter(entry => entry.kind === "allocation").map(entry => [entry.id, entry]));
  const allocatedUsage = new Map<string, number>();
  const known: Entry[] = [];
  for (const directory of await readdir(base, { withFileTypes: true })) {
    if (!safeName.test(directory.name)) continue;
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Invalid development journal directory.");
    for (const phase of ["live-before", "live-after"]) {
      const filename = path.join(base, directory.name, phase, "usage.jsonl");
      const text = await readOptional(filename);
      if (!text) continue;
      if (await realpath(filename) !== filename) throw new Error("Development journals must not redirect.");
      const source = sha(`${directory.name}/${phase}/usage.jsonl`);
      const phaseIdentity = sha(`${directory.name}/${phase}`), dayUsage = new Map<string, number>();
      let reservationDay: string | undefined;
      const lines = text.split("\n").filter(Boolean);
      const parsedEvents = lines.map(line => metadataJson<DevelopmentEvent>(line));
      const reservationDays = new Map(parsedEvents.filter(event => event.kind === "reservation" && event.requestKey).map(event => [event.requestKey!, dayOf(event.at)]));
      const dailyEvents = new Map<string, DevelopmentEvent[]>();
      for (let index = 0; index < lines.length; index++) {
        const event = parsedEvents[index];
        if (!["reservation", "response", "failure", "rejection", "quota_wait"].includes(event.kind)) throw new Error("Malformed development usage journal.");
        dayOf(event.at);
        const usageDay = (event.requestKey ? reservationDays.get(event.requestKey) : undefined) ?? (event.kind === "response" ? reservationDay : undefined) ?? dayOf(event.at);
        dailyEvents.set(usageDay, [...(dailyEvents.get(usageDay) ?? []), event]);
        if (["reservation", "response", "failure"].includes(event.kind) && (!latest || Date.parse(event.at) > Date.parse(latest))) latest = event.at;
        if (event.kind === "response" && event.usageAvailable === true) {
          if (![event.inputTokens, event.outputTokens].every(value => Number.isSafeInteger(value) && value! >= 0)) throw new Error("Malformed returned usage metadata.");
          const day = (event.requestKey ? reservationDays.get(event.requestKey) : undefined) ?? reservationDay ?? dayOf(event.at);
          dayUsage.set(day, (dayUsage.get(day) ?? 0) + event.inputTokens! + event.outputTokens!);
        }
        if (event.kind !== "reservation") continue;
        reservationDay = dayOf(event.at);
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
      for (const [day, tokens] of dayUsage) known.push({ kind: "known_usage", id: sha(`${phaseIdentity}:${day}:${tokens}`), at: `${day}T00:00:00.000Z`, phaseIdentity, source, tokens });
      for (const [day, events] of dailyEvents) { const tokens = accountedDevelopmentTokens(events); known.push({ kind: "usage_floor", id: sha(`floor:${phaseIdentity}:${day}:${tokens}`), at: `${day}T00:00:00.000Z`, phaseIdentity, source, tokens }); }
    }
  }
  for (const [id, tokens] of allocatedUsage) if (tokens > allocations.get(id)!.tokens!) throw new Error("Shared allocation was exceeded in an existing journal.");
  for (const entry of entries.filter(entry => entry.kind === "seed")) {
    const current = seeds.find(seed => seed.id === entry.id);
    if (!current || current.eventHash !== entry.eventHash || current.tokens !== entry.tokens || current.at !== entry.at) throw new Error("Previously seeded reservation metadata changed or disappeared.");
  }
  for (const entry of entries.filter(entry => ["known_usage", "usage_floor"].includes(entry.kind))) {
    const current = known.find(candidate => candidate.kind === entry.kind && candidate.phaseIdentity === entry.phaseIdentity && dayOf(candidate.at) === dayOf(entry.at));
    if (!current || current.tokens! < entry.tokens!) throw new Error("Previously recorded known usage decreased or disappeared.");
  }
  return { seeds, known, latest };
}
function snapshot(entries: Entry[], now: number, allocation: number): StudyBudgetSnapshot {
  const utcDay = new Date(now).toISOString().slice(0, 10);
  const relevant = entries.filter(entry => dayOf(entry.at) === utcDay), identities = new Map(relevant.filter(entry => ["known_usage", "usage_floor"].includes(entry.kind) && entry.source).map(entry => [entry.source!, entry.phaseIdentity!]));
  const phases = new Map<string, { reserved: number; known: number }>();
  for (const entry of relevant) {
    if (!["seed", "allocation", "known_usage", "usage_floor"].includes(entry.kind)) continue;
    const id = entry.phaseIdentity ?? identities.get(entry.source ?? "") ?? entry.source ?? entry.id;
    const values = phases.get(id) ?? { reserved: 0, known: 0 };
    if (["known_usage", "usage_floor"].includes(entry.kind)) values.known = Math.max(values.known, entry.tokens!); else values.reserved += entry.tokens!;
    phases.set(id, values);
  }
  const committedEstimatedTokens = [...phases.values()].reduce((total, phase) => total + Math.max(phase.reserved, phase.known), 0);
  const remainingEstimatedTokens = Math.max(0, MODEL_STUDY_DAILY_LIMIT - committedEstimatedTokens);
  return { utcDay, ceiling: MODEL_STUDY_DAILY_LIMIT, committedEstimatedTokens, remainingEstimatedTokens, fullPhaseAllocation: allocation, fullPairFits: allocation * 2 <= remainingEstimatedTokens, phaseFits: allocation <= remainingEstimatedTokens, scope: "For each phase/day, charge at least its full-phase allocation and the sum of each request's greater reserved estimate or known usage. Unknown requests retain their individual reservation even when another request overruns. Prior metadata is not rewritten. This does not measure provider/account quota or other applications." };
}
export async function inspectModelStudyBudget(root: string, allocation = 90000, now = Date.now()): Promise<StudyBudgetSnapshot> {
  const base = path.join(root, "eval/runs/private/development");
  const entries = parseEntries(await readOptional(path.join(base, "_model-study", "ledger.jsonl")));
  const { seeds, known } = await journalSeeds(base, entries);
  const existing = new Set(entries.map(entry => entry.id));
  return snapshot([...entries, ...seeds.filter(seed => !existing.has(seed.id)).map(seed => ({ kind: "seed" as const, ...seed })), ...known.filter(entry => !existing.has(entry.id))], now, allocation);
}

/** Exclusive across both models. Admission reserves the entire phase, not just its first request. */
export async function acquireModelStudyBudget(options: { root: string; name: string; phase: "before" | "after"; configurationHash: string; allocationTokens: number; now?: () => number }) {
  if (!safeName.test(options.name) || !hashPattern.test(options.configurationHash) || !Number.isSafeInteger(options.allocationTokens) || options.allocationTokens < 1 || options.allocationTokens > 90000) throw new Error("Invalid fixed model-study allocation.");
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
    const { seeds, known, latest } = await journalSeeds(base, entries);
    const existing = new Set(entries.map(entry => entry.id));
    for (const seed of seeds) if (!existing.has(seed.id)) await append({ kind: "seed", ...seed });
    for (const entry of known) if (!existing.has(entry.id)) await append(entry);
    let lastActivity = [...entries.filter(entry => entry.kind === "activity").map(entry => entry.at), ...(latest ? [latest] : [])].sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    const phaseIdentity = sha(`${options.name}/live-${options.phase}`);
    const phaseEvents = (await readOptional(path.join(base, options.name, `live-${options.phase}`, "usage.jsonl"))).split("\n").filter(Boolean).map(line => metadataJson<DevelopmentEvent>(line));
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
        phaseEvents.push(event);
        if (event.kind === "response" && event.usageAvailable === true) {
          const knownTokens = Math.max(0, ...entries.filter(entry => entry.kind === "known_usage" && entry.phaseIdentity === phaseIdentity && dayOf(entry.at) === dayOf(allocation.at)).map(entry => entry.tokens!)) + (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
          await append({ kind: "known_usage", at: allocation.at, id: sha(`${phaseIdentity}:${dayOf(allocation.at)}:${knownTokens}`), phaseIdentity, source: sha(`${options.name}/live-${options.phase}/usage.jsonl`), tokens: knownTokens });
          const keys = new Set(phaseEvents.filter(candidate => candidate.kind === "reservation" && dayOf(candidate.at) === dayOf(allocation.at)).flatMap(candidate => candidate.requestKey ? [candidate.requestKey] : []));
          const tokens = accountedDevelopmentTokens(phaseEvents.filter(candidate => candidate.requestKey ? keys.has(candidate.requestKey) : dayOf(candidate.at) === dayOf(allocation.at)));
          await append({ kind: "usage_floor", at: allocation.at, id: sha(`floor:${phaseIdentity}:${dayOf(allocation.at)}:${tokens}`), phaseIdentity, source: sha(`${options.name}/live-${options.phase}/usage.jsonl`), tokens });
        }
        if (["reservation", "response", "failure"].includes(event.kind) && (!lastActivity || Date.parse(event.at) > Date.parse(lastActivity))) { lastActivity = event.at; await append({ kind: "activity", at: event.at, id: allocation.id }); }
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
