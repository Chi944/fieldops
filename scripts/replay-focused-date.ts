import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractQuotation, type AIResult } from "../src/lib/ai";
import { planFocusedExtraction } from "../src/lib/ai/focused-transport";
import { parseDocument } from "../src/lib/processing";
import type { Quotation } from "../src/lib/domain/types";
import { assertDevelopmentEnvironment } from "../eval/development-control";
import { EXTRACTION_METRICS, scoreExtraction } from "../eval/metrics";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson } from "./evaluate-development";
import { auditFocusedQuotation } from "./audit-focused-development";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
async function exact(filename: string) { if (await realpath(filename) !== filename) throw new Error("Replay evidence must not redirect."); return readFile(filename); }
function decode<T>(bytes: Buffer): T { try { return JSON.parse(bytes.toString("utf8")) as T; } catch { throw new Error("Malformed private replay input."); } }
type Saved = { result: AIResult; sha256: string; originalDisposition: "validated" | "rejected" };
/** Match only complete expanded responses by exact original evidence set, never by answer quality. */
export function selectSavedTask(candidates: Saved[], ids: string[]): Saved {
  const matches = candidates.filter(candidate => {
    if (candidate.result.model !== "openai/gpt-oss-120b" || candidate.result.finishReason !== "stop" || candidate.result.rejectedAt || !candidate.result.data || typeof candidate.result.data !== "object") return false;
    const coverage = (candidate.result.data as { coverage?: { sourceId: string }[] }).coverage;
    return Array.isArray(coverage) && coverage.length === ids.length && new Set(coverage.map(row => row.sourceId)).size === ids.length && coverage.every(row => ids.includes(row.sourceId));
  });
  if (matches.length !== 1) throw new Error("Each replay task needs exactly one original complete expanded response; no best-of selection or missing response reconstruction is allowed.");
  return matches[0];
}

export async function replayFocusedDate(name: string, root = process.cwd()) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use the sealed interrupted study name.");
  assertDevelopmentEnvironment(process.env);
  const directory = path.join(root, "eval/results/development", name), privateDirectory = path.join(root, "eval/runs/private/development", name, "live-before");
  const interruptedBytes = await exact(path.join(directory, "interrupted-before.json"));
  const interrupted = decode<{ name: string; status: string; modelComparisonEligible: boolean; planSha256: string; configuration: { files: { file: string; sha256: string }[] }; documents: { id: string; status: string; outputSha256?: string }[] }>(interruptedBytes);
  if (interrupted.name !== name || interrupted.status !== "interrupted" || interrupted.modelComparisonEligible || interrupted.documents.find(row => row.id === "industrial-1")?.status !== "partial") throw new Error("The original interrupted result must remain sealed and separate.");
  // Scoring and parser changes would confound this decoder replay.
  const allowed = new Set(["src/lib/ai/index.ts", "src/lib/ai/focused-transport.ts", "src/lib/ai/groq.ts", "eval/development-control.ts", "eval/model-study-control.ts", "scripts/evaluate-development.ts", "scripts/preflight-development.ts", "scripts/compare-development.ts"]);
  const changedFiles = [];
  for (const entry of interrupted.configuration.files) if (sha(await exact(path.join(root, entry.file))) !== entry.sha256) {
    if (!allowed.has(entry.file)) throw new Error("A parser, scorer, original or unrelated frozen dependency changed.");
    changedFiles.push(entry.file);
  }
  const configuration = await fingerprint(root, "retain_valid_chunks_v1", "focused_fields_v1", { model: "openai/gpt-oss-120b" });
  const manifest = await readDevelopmentManifest(root), fixture = manifest.documents.find(row => row.id === "industrial-1")!;
  const planBytes = await exact(path.join(privateDirectory, "plan.json"));
  if (sha(planBytes) !== interrupted.planSha256) throw new Error("The original study plan changed.");
  const plan = decode<{ pair: { selection: { id: string; sha256: string; goldSha256: string }[] } }>(planBytes);
  const originalFixture = plan.pair.selection.find(row => row.id === fixture.id);
  if (originalFixture?.sha256 !== fixture.sha256 || originalFixture.goldSha256 !== sha(JSON.stringify(fixture))) throw new Error("Date-only replay requires the original source and annotations.");
  const parsed = await parseDocument({ documentId: fixture.id, filename: path.basename(fixture.path), bytes: await sourceFile(root, fixture) });
  const outputs = (await readdir(path.join(privateDirectory, "outputs"))).filter(file => /^industrial-1-[0-9]+\.json$/.test(file));
  if (outputs.length !== 1) throw new Error("Replay requires the unique original returned quotation.");
  const beforeBytes = await exact(path.join(privateDirectory, "outputs", outputs[0]));
  if (sha(beforeBytes) !== interrupted.documents.find(row => row.id === fixture.id)?.outputSha256) throw new Error("The original quotation changed.");
  const before = decode<Quotation>(beforeBytes), candidates: Saved[] = [];
  for (const disposition of ["requests", "rejected"] as const) for (const file of await readdir(path.join(privateDirectory, disposition))) {
    if (!/^[a-f0-9]{64}(?:-[0-9]+-[0-9]+)?\.json$/.test(file)) throw new Error("Unexpected private response filename.");
    const bytes = await exact(path.join(privateDirectory, disposition, file));
    const result = disposition === "requests" ? decode<AIResult>(bytes) : decode<{ result: AIResult }>(bytes).result;
    candidates.push({ result, sha256: sha(bytes), originalDisposition: disposition === "requests" ? "validated" : "rejected" });
  }
  const tasks = planFocusedExtraction(parsed);
  const selected = tasks.map(task => selectSavedTask(candidates, [...task.sources, ...task.context].map(source => source.id)));
  if (tasks.length !== 4 || selected.filter(row => row.originalDisposition === "rejected").length !== 1) throw new Error("Replay does not match the diagnosed four-response original.");
  const originalsHash = sha(JSON.stringify(selected.map(row => row.result)));
  let replayed = 0;
  const after = await extractQuotation(parsed, { chunkFailurePolicy: "retain_valid_chunks_v1", extractionTransport: "focused_fields_v1", request: async input => {
    const body = JSON.parse(input.user) as { sources: { id: string }[]; context: { id: string }[] };
    const saved = selectSavedTask(selected, [...body.sources, ...body.context].map(source => source.id)); replayed++;
    return structuredClone(saved.result);
  } });
  if (replayed !== 4 || sha(JSON.stringify(selected.map(row => row.result))) !== originalsHash || JSON.stringify(after.sources) !== JSON.stringify(before.sources)) throw new Error("Replay changed its original model responses or source records.");
  const finalConfiguration = await fingerprint(root, "retain_valid_chunks_v1", "focused_fields_v1", { model: "openai/gpt-oss-120b" });
  if (configuration.sha256 !== finalConfiguration.sha256) throw new Error("Code changed during replay.");
  const score = (quotation: Quotation) => { const result = scoreExtraction(fixture, quotation, parsed); return Object.fromEntries(EXTRACTION_METRICS.map(key => [key, result[key]])); };
  const report = { version: 1, name, mode: "offline_domain_decoder_replay", measuredAt: new Date().toISOString(), providerCalls: 0, heldoutReads: 0, originalInterruptionSha256: sha(interruptedBytes), originalOutputSha256: sha(beforeBytes), configuration, changedOriginalFiles: changedFiles,
    replayScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))), auditHelperSha256: sha(await exact(path.join(root, "scripts/audit-focused-development.ts"))), dateHelperSha256: sha(await exact(path.join(root, "src/lib/ai/dates.ts"))),
    dataset: { document: fixture.id, documents: 1, items: fixture.quotation.items.length, sourceSha256: fixture.sha256, goldSha256: sha(JSON.stringify(fixture)), split: "dev", synthetic: true },
    replayedResponses: selected.map(row => ({ sha256: row.sha256, originalDisposition: row.originalDisposition })),
    before: { status: before.status, fields: score(before), audit: auditFocusedQuotation(before, parsed) }, after: { status: after.status, fields: score(after), audit: auditFocusedQuotation(after, parsed) },
    limitations: ["Adaptive offline replay of one fully observed development quotation, not a fresh model run or the planned two-model comparison.", "The same four original expanded responses enter the current domain validator. New provider date-schema/prompt changes are not tested by this replay.", "Only a complete, exact full-month English date literally present in its existing raw excerpt can be normalized; original response bodies, raw excerpts, parser sources and references remain unchanged.", "The interrupted translation document and unattempted office document were not reconstructed, cropped or credited in this single-document result.", "Selected-field correctness and reference locations do not establish unannotated semantic correctness. Full extraction reliability and held-out validation remain unverified.", "Original response token/latency metadata carried in replayed quotations is historical; this replay incurred no inference usage and does not measure new model latency or cost."] };
  await writeImmutableJson(path.join(root, "eval/runs/private/development", name, "written-date-replay", "quotation.json"), after);
  await writeImmutableJson(path.join(directory, "written-date-replay.json"), report);
  console.log(JSON.stringify({ providerCalls: 0, before: report.before, after: report.after }));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--name") { console.error("Use --name <sealed-interrupted-study>."); process.exitCode = 1; }
  else replayFocusedDate(args[1]).catch(error => { console.error(error instanceof Error ? error.message : "Offline replay failed."); process.exitCode = 1; });
}
