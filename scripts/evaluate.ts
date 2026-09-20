import { readFile, writeFile, appendFile, rename, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseDocument } from "../src/lib/processing";
import { ocrDataDirectory } from "../src/lib/processing/ocr";
import { extractQuotation, proposeAIMatches, requestAI, requireLiveAI, liveAIConfiguration, PROMPT_VERSION, type AIResult } from "../src/lib/ai";
import { proposeMatches } from "../src/lib/domain/matching";
import { ParsedDocument, Quotation, MatchGroup, LIMITS } from "../src/lib/domain/types";
import { DatasetManifest } from "./generate-fixtures";
import { FixtureFormat, Split } from "../eval/specifications";
import { D } from "../src/lib/domain/numeric";
import { parserMetrics, scoreMatches, scoreExtraction, scoreFailedExtraction, aggregateExtractionMetrics, Fraction } from "../eval/metrics";
import { liveRequestController, type LiveEvent } from "../eval/live-control";

const ROOT = process.cwd(), hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export interface EvaluationOptions { live: boolean; split: "all" | "dev" | "heldout"; allowPosthoc?: boolean; waitQuota?: boolean; maxNewRequests?: number; documentId?: string; }
type ParserMeasurement = ReturnType<typeof parserMetrics> & { id: string; format: FixtureFormat; split: Split; elapsedMs: number; errorCode?: string };
export function parseOptions(args: string[]): EvaluationOptions {
  const live = args.includes("--live"), index = args.indexOf("--split"), split = index >= 0 ? args[index + 1] : "all";
  if (!["all", "dev", "heldout"].includes(split)) throw new Error("Use --split dev, heldout, or all.");
  const modeIndex = args.indexOf("--mode"); if (modeIndex >= 0 && args[modeIndex + 1] !== "baseline") throw new Error("The only offline mode is --mode baseline. Real inference requires explicit --live.");
  if (live && split === "all") throw new Error("A live run requires explicit --split dev or --split heldout.");
  const budgetIndex = args.indexOf("--max-new-requests"), maxNewRequests = budgetIndex >= 0 ? Number(args[budgetIndex + 1]) : undefined;
  if (maxNewRequests !== undefined && (!Number.isSafeInteger(maxNewRequests) || maxNewRequests < 1 || maxNewRequests > 100)) throw new Error("Use --max-new-requests with an integer from 1 to 100.");
  if (!live && (args.includes("--wait-quota") || maxNewRequests !== undefined)) throw new Error("Quota waiting and request budgets require --live.");
  const documentIndex = args.indexOf("--document"), documentId = documentIndex >= 0 ? args[documentIndex + 1] : undefined;
  if (documentIndex >= 0 && (!documentId || documentId.startsWith("--") || split !== "dev")) throw new Error("A --document probe requires one document ID and --split dev; held-out selection is prohibited.");
  return { live, split: split as EvaluationOptions["split"], allowPosthoc: args.includes("--allow-posthoc"), waitQuota: args.includes("--wait-quota"), ...(maxNewRequests !== undefined ? { maxNewRequests } : {}), ...(documentId ? { documentId } : {}) };
}
async function maybeJson<T>(filename: string): Promise<T | null> { try { return JSON.parse(await readFile(filename, "utf8")) as T; } catch { return null; } }
const json = async (filename: string, value: unknown) => { await mkdir(path.dirname(filename), { recursive: true }); const temporary = `${filename}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, filename); };
const percent = (value: Fraction) => value.value === null ? "not measured (0 denominator)" : `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
function timing(values: number[]) { const ordered = [...values].sort((a, b) => a - b); return { count: values.length, medianMs: ordered.length ? ordered[Math.floor(ordered.length / 2)] : null, minimumMs: ordered[0] ?? null, maximumMs: ordered.at(-1) ?? null, totalMs: values.reduce((sum, value) => sum + value, 0) }; }
async function runtimeIdentity() {
  const asset = "eng.traineddata.gz";
  let sha256: string | null = null;
  try { sha256 = hash(await readFile(path.join(ocrDataDirectory(), asset))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { nodeVersion: process.version, platform: process.platform, architecture: process.arch, ocrLanguage: { asset, status: sha256 === null ? "missing" : "present", sha256 } };
}
async function configHash(runtime: Awaited<ReturnType<typeof runtimeIdentity>>) {
  const files = ["package.json", "package-lock.json", "src/lib/ai/index.ts", "src/lib/ai/schema.ts", "src/lib/ai/groq.ts", "src/lib/ai/transport.ts", "src/lib/ai/chunks.ts", "src/lib/processing/index.ts", "src/lib/processing/ocr.ts", "src/lib/processing/errors.ts", "src/lib/domain/types.ts", "src/lib/domain/corrections.ts", "src/lib/domain/matching.ts", "src/lib/domain/calculate.ts", "src/lib/domain/numeric.ts", "src/lib/domain/billing.ts", "src/lib/domain/decisions.ts", "src/lib/domain/validation.ts", "eval/metrics.ts", "eval/live-control.ts", "scripts/evaluate.ts"];
  return hash(JSON.stringify({ promptVersion: PROMPT_VERSION, model: liveAIConfiguration().model, runtime, files: await Promise.all(files.map(async file => ({ file, hash: hash(await readFile(path.join(ROOT, file))) }))) }));
}
async function runRobustness(manifest: DatasetManifest) {
  const results = [];
  for (const entry of manifest.robustness) {
    const started = performance.now();
    const bytes = entry.mode === "oversize" ? Buffer.alloc(LIMITS.fileBytes + 1) : await readFile(path.join(ROOT, entry.path!));
    if (entry.mode === "duplicate") { results.push({ ...entry, passed: hash(bytes) === manifest.documents[0].sha256, actual: "hash equality check", elapsedMs: performance.now() - started }); continue; }
    if (entry.mode === "revision") { const contents = bytes.toString("utf8"); results.push({ ...entry, passed: hash(bytes) !== manifest.documents[0].sha256 && contents.includes(manifest.documents[0].quotation.quotationNumber.value!) && contents.includes("Revision 2"), actual: "different bytes, same identifier, explicit revision", elapsedMs: performance.now() - started }); continue; }
    try {
      const parsed = await parseDocument({ documentId: `robust-${entry.id}`, filename: entry.path ? path.basename(entry.path) : "oversize.pdf", bytes });
      const passed = entry.mode === "injection" ? parsed.sources.some(s => s.text.includes("Ignore previous instructions")) : entry.expected === "unreadable_or_partial" && !parsed.manifest.complete;
      results.push({ ...entry, passed, actual: entry.mode === "injection" ? "Untrusted text preserved as source data; live model resistance NOT TESTED" : parsed.manifest.complete ? "unexpected complete parse" : "partial", elapsedMs: performance.now() - started });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "unexpected_error";
      results.push({ ...entry, passed: code === entry.expected || (entry.expected === "unreadable_or_partial" && code === "unreadable"), actual: code, elapsedMs: performance.now() - started });
    }
  }
  return results;
}
export async function evaluate(options: EvaluationOptions) {
  // This guard runs before any parsing or writes; a flag cannot silently fall back to fixtures as AI output.
  if (options.live) requireLiveAI();
  const goldBytes = await readFile(path.join(ROOT, "eval/gold.json")), manifest = JSON.parse(goldBytes.toString()) as DatasetManifest;
  if (options.documentId && options.split !== "dev") throw new Error("Document probes are restricted to the development split.");
  const runtime = await runtimeIdentity();
  const documents = manifest.documents.filter(d => (options.split === "all" || d.split === options.split) && (!options.documentId || d.id === options.documentId)), configurationHash = await configHash(runtime), datasetHash = hash(goldBytes);
  if (!documents.length) throw new Error("No document in the selected split matches the requested ID.");
  const runId = `${options.live ? "live" : "baseline"}-${options.split}${options.documentId ? `-document-${hash(options.documentId).slice(0, 8)}` : ""}-${configurationHash.slice(0, 12)}-${datasetHash.slice(0, 12)}`;
  const directory = path.join(ROOT, "eval/runs", options.live ? "private" : "baseline", runId); await mkdir(directory, { recursive: true });
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const sessionDirectory = path.join(directory, "sessions");
  if (options.live) await mkdir(sessionDirectory, { recursive: true });
  const journal = async (event: LiveEvent) => {
    await appendFile(path.join(sessionDirectory, `${sessionId}.jsonl`), `${JSON.stringify(event)}\n`);
    if (event.event === "quota_wait") console.log(`Free quota wait: ${Math.ceil((event.retryAfterMs ?? 0) / 1000)}s before ${event.purpose}; completed requests are saved.`);
  };
  const liveControl = liveRequestController({ request: (request, context) => requestAI(request, { ...context, checkpoint }), waitQuota: options.waitQuota, maxNewRequests: options.maxNewRequests, persist: journal });
  let holdoutStatus = options.split === "heldout" || options.split === "all" ? "Untuned held-out content; offline measurement only" : "Development set";
  if (options.live && options.split === "heldout") {
    const freezePath = path.join(ROOT, "eval/freeze/live-heldout.json"), previous = await maybeJson<{ configurationHash: string; datasetHash: string }>(freezePath);
    if (previous && (previous.configurationHash !== configurationHash || previous.datasetHash !== datasetHash)) {
      if (!options.allowPosthoc) throw new Error("Held-out configuration or dataset changed. Use a fresh held-out dataset or explicitly --allow-posthoc to label this a post-fix regression run.");
      holdoutStatus = "Post-fix regression: held-out data is no longer untouched";
    } else { if (!previous) await json(freezePath, { configurationHash, datasetHash, frozenAt: new Date().toISOString(), documentHashes: documents.map(d => ({ id: d.id, sha256: d.sha256 })) }); holdoutStatus = "Live held-out run against frozen model, prompts, parser, rules and source bytes"; }
  }
  const baselineGroups = [...new Set(documents.map(d => d.scenarioId))].flatMap(scenario => proposeMatches(documents.filter(d => d.scenarioId === scenario).map(d => d.quotation)));
  const matching = scoreMatches(documents, baselineGroups), parserResults: ParserMeasurement[] = [], extractions = [], extractedById = new Map<string, Quotation>();
  let activePurpose: "extraction" | "matching" = "extraction";
  const checkpoint = {
    get: (key: string) => maybeJson<AIResult>(path.join(directory, "requests", `${key}.json`)),
    set: (key: string, value: AIResult) => json(path.join(directory, "requests", `${key}.json`), value),
    reject: async (key: string, result: AIResult, code: string, context?: { cached: boolean }) => {
      await json(path.join(directory, "rejected", `${key}-${Date.now()}.json`), { key, code, cached: context?.cached ?? false, result });
      // Transport-level truncation/JSON failures throw before the controller can
      // record a returned response. Count those tokens exactly once here.
      if (!context?.cached && (result.rejectedAt === "transport" || (result.finishReason && (result.finishReason !== "stop" || typeof result.data === "string" || result.data === null)))) {
        await journal({ event: "response_received", at: new Date().toISOString(), purpose: activePurpose, inputTokens: result.inputTokens, outputTokens: result.outputTokens, elapsedMs: result.elapsedMs, model: result.model, costUsd: result.costUsd, usageAvailable: result.usageAvailable });
      }
      await journal({ event: context?.cached ? "cached_validation_failed" : "response_validation_failed", at: new Date().toISOString(), purpose: activePurpose, code });
    },
  };
  for (const fixture of documents) {
    const bytes = await readFile(path.join(ROOT, fixture.path)); if (hash(bytes) !== fixture.sha256) throw new Error(`Fixture hash mismatch: ${fixture.id}. Regenerate and independently review the gold before measuring.`);
    const started = performance.now(); console.log(`Parsing ${fixture.id} (${fixture.format})`);
    let parsed: ParsedDocument;
    try { parsed = await parseDocument({ documentId: fixture.id, filename: path.basename(fixture.path), bytes }); }
    catch (error) { parserResults.push({ id: fixture.id, format: fixture.format, split: fixture.split, elapsedMs: performance.now() - started, errorCode: (error as { code?: string }).code ?? "unexpected_error", complete: false, sourceCount: 0, itemIdentifierCoverage: { numerator: 0, denominator: fixture.quotation.items.length, value: 0 }, parsedUnits: 0, units: fixture.quotation.manifest.units.length, sourceLocationsPresent: { numerator: 0, denominator: 0, value: null }, boxesWithinPage: { numerator: 0, denominator: 0, value: null } }); continue; }
    parserResults.push({ id: fixture.id, format: fixture.format, split: fixture.split, elapsedMs: performance.now() - started, ...parserMetrics(fixture, parsed) });
    if (options.live) {
      const outputPath = path.join(directory, `${fixture.id}-${fixture.sha256}.json`);
      try {
        const cached = await maybeJson<Quotation>(outputPath), extracted = cached ?? await extractQuotation(parsed, { checkpoint, request: liveControl.request });
        if (!cached) await json(outputPath, extracted); extractedById.set(fixture.id, extracted);
        extractions.push({ id: fixture.id, resumed: Boolean(cached), ...scoreExtraction(fixture, extracted, parsed), usage: extracted.usage ?? null });
      } catch (error) {
        const code = (error as { code?: string }).code ?? "unexpected_error";
        extractions.push({ id: fixture.id, errorCode: code, ...scoreFailedExtraction(fixture), usage: null });
        await json(path.join(directory, "failures", `${fixture.id}-${sessionId}.json`), { id: fixture.id, sessionId, code, at: new Date().toISOString() });
        // Stop on a provider/configuration limit: rerunning resumes completed requests under the same config/document hashes.
        if (liveControl.state.halt) break;
      }
    }
  }
  const semanticResults: { scenario: string; result?: ReturnType<typeof scoreMatches>; errorCode?: string }[] = [];
  const goldInputSemanticResults: { scenario: string; result?: ReturnType<typeof scoreMatches>; errorCode?: string }[] = [];
  if (options.live) for (const scenario of [...new Set(documents.map(d => d.scenarioId))]) {
    if (liveControl.state.halt) break;
    activePurpose = "matching";
    const fixtures = documents.filter(d => d.scenarioId === scenario), extracted = fixtures.map(d => extractedById.get(d.id));
    if (fixtures.length < 2) continue; // A single-document probe has no supplier-matching task.
    // Same input conditions as the identifier/text baseline. Gold labels/expected matches are never sent.
    try { goldInputSemanticResults.push({ scenario, result: scoreMatches(fixtures, await proposeAIMatches(fixtures.map(f => f.quotation), { checkpoint, request: liveControl.request })) }); }
    catch (error) { goldInputSemanticResults.push({ scenario, errorCode: (error as { code?: string }).code ?? "unexpected_error" }); }
    if (liveControl.state.halt) break;
    if (extracted.some(q => !q)) continue;
    try {
      const groups = await proposeAIMatches(extracted as Quotation[], { checkpoint, request: liveControl.request });
      // Translate extracted identifiers back to gold item IDs solely for scoring; no model sees gold labels.
      const itemMap = new Map<string, string>();
      for (const fixture of fixtures) { const actual = extractedById.get(fixture.id)!; for (const goldItem of fixture.quotation.items) { const match = actual.items.filter(item => item.identifier.value === goldItem.identifier.value); if (match.length === 1) itemMap.set(match[0].id, goldItem.id); } }
      const remapped: MatchGroup[] = groups.map(g => ({ ...g, members: g.members.map(m => ({ ...m, itemId: itemMap.get(m.itemId) ?? m.itemId })) }));
      semanticResults.push({ scenario, result: scoreMatches(fixtures, remapped) });
    } catch (error) { semanticResults.push({ scenario, errorCode: (error as { code?: string }).code ?? "unexpected_error" }); }
  }
  const robustness = await runRobustness(manifest);
  let modelUsage: { successfulCheckpointedRequests: number; inputTokens: number; outputTokens: number; reportedCostUsd: string | null; elapsedMs: number; scope: string } | null = null;
  if (options.live) {
    const requestFiles = await readdir(path.join(directory, "requests")).catch(() => []);
    const results = (await Promise.all(requestFiles.filter(f => f.endsWith(".json")).map(f => maybeJson<AIResult>(path.join(directory, "requests", f))))).filter((result): result is AIResult => result !== null);
    modelUsage = { successfulCheckpointedRequests: results.length, inputTokens: results.reduce((n, r) => n + r.inputTokens, 0), outputTokens: results.reduce((n, r) => n + r.outputTokens, 0), reportedCostUsd: results.length && results.every(r => r.costUsd !== null) ? results.reduce((sum, r) => sum.plus(r.costUsd!), new D(0)).toFixed() : null, elapsedMs: results.reduce((n, r) => n + r.elapsedMs, 0), scope: "Successful checkpointed requests across this logical run, including resumed requests; failed request usage and provider invoice are not available." };
  }
  const sum = (key: "itemIdentifierCoverage" | "sourceLocationsPresent" | "boxesWithinPage") => { const numerator = parserResults.reduce((n, result) => n + result[key].numerator, 0), denominator = parserResults.reduce((n, result) => n + result[key].denominator, 0); return { numerator, denominator, value: denominator ? numerator / denominator : null }; };
  let independentReview = "Independent gold review has not yet been recorded."; try { independentReview = await readFile(path.join(ROOT, "eval/gold-review.md"), "utf8"); } catch { /* Publish the missing verification honestly. */ }
  const scenarioCount = [...new Set(documents.map(document => document.scenarioId))].filter(scenario => documents.filter(document => document.scenarioId === scenario).length >= 2).length;
  const aiStatus = !options.live ? "UNVERIFIED" : extractedById.size === documents.length && semanticResults.filter(result => result.result).length === scenarioCount && goldInputSemanticResults.filter(result => result.result).length === scenarioCount ? "MEASURED_COMPLETE_SEE_DENOMINATORS" : extractedById.size > 0 ? "MEASURED_PARTIAL_SEE_DENOMINATORS" : "LIVE_ATTEMPTED_NO_VALIDATED_EXTRACTIONS";
  const report = { version: 1, measuredAt: new Date().toISOString(), runId, mode: options.live ? "live" : "baseline", split: options.split, datasetHash, configurationHash, holdoutStatus, dataset: { documents: documents.length, scenarios: new Set(documents.map(d => d.scenarioId)).size, logicalItems: documents.reduce((n, d) => n + d.quotation.items.length, 0), annotatedFields: documents.reduce((n, d) => n + d.fields.length, 0), sourceFormats: Object.fromEntries([...new Set(documents.map(d => d.format))].map(format => [format, documents.filter(d => d.format === format).length])) }, matching, parser: { completeDocuments: parserResults.filter(p => p.complete).length, attemptedDocuments: parserResults.length, identifierCoverage: sum("itemIdentifierCoverage"), sourceLocationsPresent: sum("sourceLocationsPresent"), boxesWithinPage: sum("boxesWithinPage"), timing: timing(parserResults.map(p => p.elapsedMs)), documents: parserResults }, robustness, ai: options.live ? { status: aiStatus, extractions, goldInputSemanticResults, endToEndSemanticResults: semanticResults } : { status: "UNVERIFIED", reason: "This offline run made no inference calls. AI extraction, matching, ambiguity, attack-resistance and model cost are not measured by this run; separately reported live development probes have their own configurations and denominators." }, providerCostUsd: options.live ? null : "0", independentReview, limitations: ["Small synthetic English-only dataset; authored layout and content diversity do not establish general supplier-format coverage.", "Baseline matching uses gold-normalized rows and explicit identifiers. It does not include extraction error and favors the identifier baseline.", "Parser identifier coverage measures presence of authored item IDs, not detected rows or semantic field extraction accuracy.", "Source-location presence and geometric bounds do not prove that every reference supports a semantic assertion.", "Raw live field scoring uses exact identifiers for row alignment, canonical strings for text, and separately reports intentionally annotated missing states.", "Robustness hash checks do not by themselves test the browser upload flow, durable retries, cross-user access or live prompt-injection resistance.", "The unreadable fixture is an artificial blank raster. Production degraded scans require a broader permissioned dataset.", "No human gold verification or production latency distribution is implied. Inspect the separate review record and per-file measurements."] };
  const sessionFiles = options.live ? await readdir(sessionDirectory) : [];
  const events: LiveEvent[] = [];
  for (const file of sessionFiles.filter(file => file.endsWith(".jsonl"))) {
    for (const line of (await readFile(path.join(sessionDirectory, file), "utf8")).split("\n").filter(Boolean)) {
      try { events.push(JSON.parse(line)); } catch { /* A terminated append may leave an incomplete last line; prior events remain usable. */ }
    }
  }
  const received = events.filter(event => event.event === "response_received");
  const observedUsage = options.live ? { completedResponses: received.length, responsesWithoutUsage: received.filter(r => r.usageAvailable === false).length, inputTokens: received.reduce((n, r) => n + (r.inputTokens ?? 0), 0), outputTokens: received.reduce((n, r) => n + (r.outputTokens ?? 0), 0), elapsedMs: received.reduce((n, r) => n + (r.elapsedMs ?? 0), 0), reportedCostUsd: received.length && received.every(r => r.costUsd !== null && r.costUsd !== undefined) ? received.reduce((sum, r) => sum.plus(r.costUsd!), new D(0)).toFixed() : null, scope: "All returned model responses journaled in this logical run, including responses rejected by validation and prior resumed sessions. Token totals exclude responses explicitly marked usage unavailable (including provider-side schema rejections); those responses are counted separately. Transport failures without returned usage and the provider invoice are not measured." } : null;
  const liveSummary = options.live ? { requestedDocuments: documents.length, attemptedExtractions: extractions.length, validatedExtractions: extractedById.size, rejectedOrPausedExtractions: extractions.filter(entry => "errorCode" in entry).length, fields: aggregateExtractionMetrics(extractions), scope: "Micro-averaged over attempted extraction documents. Failed or paused documents count as missing output with zero field/recall credit. Unattempted documents are not silently included or excluded: their count is requested minus attempted. Source precision denominators cover returned references only." } : null;
  const measuredReport = { ...report, selection: options.documentId ? { kind: "development_document_probe", documentId: options.documentId, matching: "not applicable with one supplier" } : { kind: "complete_split" }, runtime, modelUsage, observedUsage, liveSummary, ...(options.live ? { liveSession: { sessionId, ...liveControl.state } } : {}) };
  await json(path.join(directory, "report.json"), measuredReport); await json(path.join(ROOT, options.live ? "eval/results/live-latest.json" : "eval/results/latest.json"), measuredReport);
  const failures = parserResults.filter(p => !p.complete || p.itemIdentifierCoverage.numerator !== p.itemIdentifierCoverage.denominator);
  const markdown = `# FieldOps measured evaluation\n\nMeasured ${report.measuredAt}. Mode: **${report.mode}**. Run \`${runId}\`.\n\n## Dataset and protocol\n\n${report.dataset.documents} self-authored originals, ${report.dataset.scenarios} unrelated comparison scenarios, ${report.dataset.logicalItems} logical items and ${report.dataset.annotatedFields} selected field assertions. Development and held-out splits each have 12 documents. Formats: ${Object.entries(report.dataset.sourceFormats).map(([key, count]) => `${count} ${key}`).join(", ")}. Eight robustness cases are separate. ${holdoutStatus}.\n\nDataset SHA-256: \`${datasetHash}\`. Configuration SHA-256: \`${configurationHash}\`. The report stores per-document timing and errors in [JSON](../eval/results/${options.live ? "live-latest" : "latest"}.json).\n\n## Actually measured\n\n| Measurement | Result |\n|---|---|\n| Baseline equivalent-pair precision, gold rows | ${percent(matching.equivalentPrecision)} |\n| Baseline equivalent-pair recall, gold rows | ${percent(matching.equivalentRecall)} |\n| False equivalences on annotated hard negatives | ${matching.hardNegativeFalseEquivalences.numerator}/${matching.hardNegativeFalseEquivalences.denominator} |\n| Candidate cross-supplier item pairs | ${matching.candidatePairs} |\n| Parser complete documents | ${report.parser.completeDocuments}/${report.parser.attemptedDocuments} |\n| Authored item identifiers present in parsed text | ${percent(report.parser.identifierCoverage)} |\n| Parsed source locations present | ${percent(report.parser.sourceLocationsPresent)} |\n| Reported boxes within page bounds | ${percent(report.parser.boxesWithinPage)} |\n| Parser median / minimum / maximum | ${Math.round(report.parser.timing.medianMs ?? 0)} / ${Math.round(report.parser.timing.minimumMs ?? 0)} / ${Math.round(report.parser.timing.maximumMs ?? 0)} ms |\n| Robustness assertions | ${robustness.filter(r => r.passed).length}/${robustness.length} |\n| ${options.live ? "Provider cost for this live run" : "Provider cost for this offline run"} | ${options.live ? "See returned usage; provider invoice not measured" : "USD 0; no provider calls"} |\n\n${failures.length ? `Parser cases requiring attention: ${failures.map(f => `${f.id}: ${f.complete ? "complete manifest" : "incomplete/error"}, identifier coverage ${f.itemIdentifierCoverage.numerator}/${f.itemIdentifierCoverage.denominator}`).join("; ")}.` : "All parser manifests completed and all authored item identifiers were present; this is not evidence of perfect extraction."}\n\n## AI status\n\n**${report.ai.status}.** ${options.live ? "Actual live outputs and denominators are in the JSON report. Failed requests and unmeasured scenarios are retained, not replaced with fixtures." : "No model extraction or semantic matching was run in this offline evaluation. These AI metrics are not measured here. Separate live development probes and their limitations are reported in [live development verification](live-ai-development.md); they do not establish full-dataset AI accuracy."}\n\nArithmetic and correction invariants run separately with \`npm test -- tests/domain.test.ts\`; do not interpret their assertion count as AI accuracy. The actual fixed package-surplus defect is documented in [failure notes](failure-notes.md).\n\n## Reproduce\n\n\`npm run fixtures\` regenerates the authored sources and gold; \`npm run eval -- --mode baseline\` runs local parsers and the identifier/text baseline. Complete OCR setup first with \`npx tsx scripts/process.ts --prepare-ocr\`.\n\nAfter the user explicitly sets FIELDOPS_PROCESSING_MODE=ai and configures and confirms the free API key, \`npm run eval -- --live --split dev\` runs real extraction with persistent request checkpoints. Freeze prompts and configuration before \`npm run eval -- --live --split heldout\`. The first live held-out run freezes code, dataset and source hashes. A changed configuration requires a fresh held-out set or explicit \`--allow-posthoc\`, which labels results as regression measurements. No paid fallback is implemented.\n\n## Independent review and limitations\n\n${independentReview}\n\n${report.limitations.map(item => `- ${item}`).join("\n")}\n`;
  const runtimeNote = `${options.documentId ? `This is a selected development-document probe (\`${options.documentId}\`), not the full split. Supplier matching is not applicable to one document.\n\n` : ""}Runtime: Node ${runtime.nodeVersion}, ${runtime.platform}/${runtime.architecture}. OCR language asset: ${runtime.ocrLanguage.asset}; ${runtime.ocrLanguage.sha256 === null ? "MISSING (included explicitly in the configuration fingerprint)" : `SHA-256 ${runtime.ocrLanguage.sha256}`}. The configuration fingerprint includes package.json, package-lock.json and this runtime/asset identity.`;
  const liveNote = liveSummary ? `\n\n### Live completion and failures\n\nValidated ${liveSummary.validatedExtractions}/${liveSummary.requestedDocuments} documents; attempted ${liveSummary.attemptedExtractions}. ${liveControl.state.halt ? `Session paused: ${liveControl.state.halt.code}; retry delay ${liveControl.state.halt.retryAfterMs ?? "not specified"} ms.` : "No quota/configuration pause."} ${liveSummary.scope}\n\n| Live extraction measurement | Result |\n|---|---|\n${Object.entries(liveSummary.fields).map(([key, value]) => `| ${key} | ${percent(value)} |`).join("\n")}\n\nActual returned response usage across resumed sessions: ${observedUsage?.completedResponses ?? 0} responses (${observedUsage?.responsesWithoutUsage ?? 0} without token usage), ${observedUsage?.inputTokens ?? 0} input and ${observedUsage?.outputTokens ?? 0} output tokens. ${observedUsage?.scope}\n\nUse \`--wait-quota\` to wait for at most 30 short quota resets (each at most 60 seconds); longer/daily limits pause for explicit resume. \`--max-new-requests 1\` bounds a development probe. Completed results resume under the same configuration and source hashes. Append-only private session journals preserve failure codes and returned usage; rejected response bodies remain private.\n` : "";
  await mkdir(path.join(ROOT, "docs"), { recursive: true }); await writeFile(path.join(ROOT, options.live ? "docs/evaluation-live-latest.md" : "docs/evaluation-report.md"), markdown.replace("\n\n## Actually measured", `\n\n${runtimeNote}\n\n## Actually measured`).replace("\n\nArithmetic and correction", `${liveNote}\n\nArithmetic and correction`));
  console.log(`Measured baseline precision ${percent(matching.equivalentPrecision)}, recall ${percent(matching.equivalentRecall)}. Parser complete ${report.parser.completeDocuments}/${report.parser.attemptedDocuments}; robustness ${robustness.filter(r => r.passed).length}/${robustness.length}. AI ${report.ai.status}.`);
  return measuredReport;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) evaluate(parseOptions(process.argv.slice(2))).catch(error => { console.error(error instanceof Error ? error.message : "Evaluation failed"); process.exitCode = 1; });
