import { createHash } from "node:crypto";
import { readFile, readdir, realpath, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevelopmentEnvironment, PAIRED_COHORT, summarizeDevelopmentUsage, type DevelopmentEvent } from "../eval/development-control";
import { aggregateExtractionMetrics, EXTRACTION_METRICS, scoreExtraction, scoreFailedExtraction } from "../eval/metrics";
import { inspectModelStudyBudget } from "../eval/model-study-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson } from "./evaluate-development";
import { parseDocument } from "../src/lib/processing";
import type { Quotation } from "../src/lib/domain/types";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
async function exact(filename: string) { if (await realpath(filename) !== filename) throw new Error("Interrupted study inputs must not redirect."); return readFile(filename); }
function json<T>(bytes: Buffer): T { try { return JSON.parse(bytes.toString("utf8")) as T; } catch { throw new Error("Malformed study metadata."); } }
export function assertStopped(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid recorded runner PID.");
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw new Error("Cannot establish that the runner stopped."); }
  throw new Error("The recorded runner PID is still active; no interruption report was written.");
}
/** No inference or output reconstruction. Missing final quotations receive zero recall credit. */
export async function reportInterruptedFocused(name: string, root = process.cwd()) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use an existing development study name.");
  assertDevelopmentEnvironment(process.env);
  const publicDirectory = path.join(root, "eval/results/development", name);
  const privateDirectory = path.join(root, "eval/runs/private/development", name, "live-before");
  try { await access(path.join(publicDirectory, "live-before.json")); throw new Error("A finalized phase is not an interrupted study."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const lockBytes = await exact(path.join(privateDirectory, "run.lock"));
  const lock = json<{ pid: number; startedAt: string }>(lockBytes); assertStopped(lock.pid);
  const sharedLock = json<{ pid: number }>(await exact(path.join(root, "eval/runs/private/development/_model-study/run.lock")));
  if (sharedLock.pid !== lock.pid) throw new Error("The shared lock belongs to another runner.");
  const preflightBytes = await exact(path.join(publicDirectory, "offline-preflight.json"));
  const preflight = json<{ name: string; comparisonKind: string; fits: boolean; models: { configuration: Awaited<ReturnType<typeof fingerprint>> }[] }>(preflightBytes);
  const configuration = await fingerprint(root, "retain_valid_chunks_v1", "focused_fields_v1", { model: "openai/gpt-oss-120b" });
  if (preflight.name !== name || preflight.comparisonKind !== "model" || !preflight.fits || preflight.models[0]?.configuration.sha256 !== configuration.sha256) throw new Error("Interrupted evidence requires the exact frozen first-model implementation.");
  const planBytes = await exact(path.join(privateDirectory, "plan.json"));
  const plan = json<{ configurationHash: string; preflightSha256: string; pair: { selection: { id: string; sha256: string; goldSha256: string }[] } }>(planBytes);
  if (plan.configurationHash !== configuration.sha256 || plan.preflightSha256 !== hash(preflightBytes) || JSON.stringify(plan.pair.selection.map(row => row.id)) !== JSON.stringify(PAIRED_COHORT)) throw new Error("The interrupted plan identity is inconsistent.");
  const journalBytes = await exact(path.join(privateDirectory, "usage.jsonl"));
  const events = journalBytes.toString("utf8").split("\n").filter(Boolean).map(line => json<DevelopmentEvent>(Buffer.from(line)));
  if (events.some(event => !Number.isFinite(Date.parse(event.at)) || !PAIRED_COHORT.includes(event.documentId ?? "") || !["reservation", "response", "failure", "rejection", "quota_wait"].includes(event.kind))) throw new Error("The interrupted journal has invalid metadata.");
  const manifest = await readDevelopmentManifest(root), scores = [], documents = [];
  const outputDirectory = path.join(privateDirectory, "outputs"), outputNames = await readdir(outputDirectory);
  const lastRecordedAt = events.at(-1)?.at;
  if (!lastRecordedAt || !Number.isFinite(Date.parse(lock.startedAt))) throw new Error("The interrupted run has no valid observation interval.");
  for (const id of PAIRED_COHORT) {
    const fixture = manifest.documents.find(row => row.id === id)!;
    const selected = plan.pair.selection.find(row => row.id === id)!;
    if (selected.sha256 !== fixture.sha256 || selected.goldSha256 !== hash(JSON.stringify(fixture))) throw new Error("The interrupted source or annotation identity changed.");
    const parsed = await parseDocument({ documentId: id, filename: path.basename(fixture.path), bytes: await sourceFile(root, fixture) });
    const calls = events.filter(event => event.documentId === id && event.kind === "reservation").length;
    const candidates = outputNames.filter(filename => new RegExp(`^${id}-[0-9]+\\.json$`).test(filename));
    if (candidates.length > 1) throw new Error("Multiple returned outputs require an explicit session audit.");
    if (!candidates.length) {
      const score = scoreFailedExtraction(fixture); scores.push(score);
      documents.push({ id, status: calls ? "interrupted_without_final_quotation" : "not_attempted", providerDispatches: calls, retainedFinalQuotation: false, score: Object.fromEntries(EXTRACTION_METRICS.map(key => [key, score[key]])) });
      continue;
    }
    const outputBytes = await exact(path.join(outputDirectory, candidates[0]));
    const quotation = json<Quotation>(outputBytes);
    if (quotation.documentId !== id || quotation.contentHash !== fixture.sha256 || !["ready", "partial"].includes(quotation.status) || JSON.stringify(quotation.sources) !== JSON.stringify(parsed.sources)) throw new Error("A saved quotation does not preserve the selected original.");
    const outputTime = Number(candidates[0].slice(id.length + 1, -5));
    if (outputTime < Date.parse(lock.startedAt) || outputTime > Date.parse(lastRecordedAt)) throw new Error("A returned quotation lies outside the recorded phase.");
    const score = scoreExtraction(fixture, quotation, parsed); scores.push(score);
    documents.push({ id, status: quotation.status, providerDispatches: calls, retainedFinalQuotation: true, outputSha256: hash(outputBytes), originalSourceArrayPreserved: true, sourceCount: parsed.sources.length, retainedItems: quotation.items.length, score: Object.fromEntries(EXTRACTION_METRICS.map(key => [key, score[key]])) });
  }
  assertStopped(lock.pid);
  if (hash(await exact(path.join(privateDirectory, "usage.jsonl"))) !== hash(journalBytes)) throw new Error("The interrupted journal changed during inspection.");
  const report = { version: 1, name, phase: "before", status: "interrupted", modelComparisonEligible: false, reportedAt: new Date().toISOString(), originalRunnerAbsent: true, interruptionCause: "unverified", firstRecordedStart: lock.startedAt, lastRecordedEvent: lastRecordedAt,
    providerCallsByThisReporter: 0, heldoutReadsByThisReporter: 0, configuration, preflightSha256: hash(preflightBytes), planSha256: hash(planBytes), journalSha256: hash(journalBytes), lockSha256: hash(lockBytes), reporterSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    dataset: { requestedDocuments: 3, logicalItems: manifest.documents.filter(row => PAIRED_COHORT.includes(row.id)).reduce((sum, row) => sum + row.quotation.items.length, 0), split: "dev", synthetic: true },
    observedUsage: summarizeDevelopmentUsage(events), budget: await inspectModelStudyBudget(root), fields: aggregateExtractionMetrics(scores), documents,
    limitations: ["This is not a finalized live-before report and must not enter the planned two-model comparison.", "Only saved final quotation outputs are scored. Incomplete documents and unattempted documents receive zero recall credit against the entire fixed cohort; cached sections are not fabricated into final quotations.", "Source references resolving or retained source arrays matching does not prove semantic correctness.", "Recorded quota waits may include a wait interrupted before completion. Full end-to-end latency and provider invoice cost are unavailable.", "Known returned token use may exceed character-based estimates; the original estimated reservations and full-phase allocation remain unchanged, with no refund.", "Original results, private responses and both stopped-run lock files remain untouched. No model response was retried or repaired."] };
  await writeImmutableJson(path.join(publicDirectory, "interrupted-before.json"), report);
  console.log(JSON.stringify({ status: report.status, documents: report.documents.map(row => ({ id: row.id, status: row.status })), fields: report.fields, observedUsage: report.observedUsage, budget: report.budget }));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--name") { console.error("Use --name <interrupted-development-study>."); process.exitCode = 1; }
  else reportInterruptedFocused(args[1]).catch(error => { console.error(error instanceof Error ? error.message : "Interruption reporting failed."); process.exitCode = 1; });
}
