import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractQuotation, extractionChunks } from "../src/lib/ai";
import { AIInterpretationError, compactExtractionRequest, PROMPT_VERSION, type AIRequest, type AIResult } from "../src/lib/ai/groq";
import { parseDocument, ProcessingError } from "../src/lib/processing";
import type { ParsedDocument, Quotation } from "../src/lib/domain/types";
import { aggregateExtractionMetrics, EXTRACTION_METRICS, scoreExtraction, scoreFailedExtraction } from "../eval/metrics";
import { auditExtractionReadiness } from "../eval/readiness";
import { assertDevelopmentEnvironment, PAIRED_COHORT, summarizeDevelopmentUsage, type DevelopmentEvent } from "../eval/development-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson, type evaluateDevelopment } from "./evaluate-development";
import { auditRetainedQuotation } from "./audit-development-sections";

type Report = Awaited<ReturnType<typeof evaluateDevelopment>>;
type Identity = Report["configuration"];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const modelNames = new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
const decoderFile = "src/lib/ai/fact-transport.ts";
const options = { extractionTransport: "fact_ledger_v1", chunkFailurePolicy: "retain_valid_chunks_v1" } as const;
const requestKey = (request: AIRequest, model: string) => sha(JSON.stringify({ version: PROMPT_VERSION, model, request }));
export type FactReplayVariant = "root-alias" | "tier-range";
function variantDetails(variant: FactReplayVariant) {
  if (variant === "root-alias") return { suffix: "", files: [decoderFile], purpose: "Revalidate the original saved responses after the root-entity alias decoder correction." };
  if (variant === "tier-range") return { suffix: "-tier-range", files: [decoderFile, "src/lib/ai/index.ts"], purpose: "Revalidate the same original saved responses after the root-alias correction and the same-item complete tier-range evidence guard." };
  throw new Error("Only the root-alias and explicit tier-range replay variants are supported.");
}
export function parseFactReplayArguments(args: string[]): { name: string; variant: FactReplayVariant } {
  if (args[0] !== "--name" || !/^[a-z][a-z0-9-]{2,63}$/.test(args[1] ?? "") || !(args.length === 2 || (args.length === 4 && args[2] === "--variant" && args[3] === "tier-range"))) throw new Error("Use --name <finalized-development-experiment> [--variant tier-range].");
  return { name: args[1], variant: args.length === 4 ? "tier-range" : "root-alias" };
}

export class ReplayUnavailableError extends Error {
  constructor(readonly reason: string) { super("This saved response cannot be replayed; no replacement response will be generated."); }
}
export class PreservedReplayRejection extends AIInterpretationError {
  constructor(code: "invalid_output" | "invalid_evidence", result: AIResult, readonly reason: string) { super(new ProcessingError(code, "The recorded provider response remains rejected during offline replay."), result, true); }
}
export interface SavedReplayResponse { kind: "accepted_checkpoint" | "rejected_record"; value: unknown; sha256: string; }

/** Only finalized, complete source cohorts enter this offline path. This says
 * nothing about whether the live extraction itself completed successfully. */
export function assertFactReplayReport(value: unknown, name: string): asserts value is Report {
  const report = object(value), configuration = object(report?.configuration), dataset = object(report?.dataset), pair = object(report?.pair);
  const selection = Array.isArray(pair?.selection) ? pair.selection : [], measurements = Array.isArray(report?.measurements) ? report.measurements : [];
  const started = typeof report?.startedAt === "string" ? Date.parse(report.startedAt) : NaN, finished = typeof report?.measuredAt === "string" ? Date.parse(report.measuredAt) : NaN;
  if (report?.name !== name || report.phase !== "after" || report.mode !== "live" || report.configurationStableDuringRun !== true || configuration?.extractionTransport !== options.extractionTransport || configuration.chunkFailurePolicy !== options.chunkFailurePolicy || !hex(configuration.sha256) || !modelNames.has(String(configuration.model)) || dataset?.split !== "dev" || dataset.synthetic !== true || dataset.requestedDocuments !== 3 || dataset.heldoutDocumentsRead !== 0 || dataset.heldoutModelCalls !== 0 || pair?.split !== "dev" || pair.synthetic !== true || pair.mode !== "live" || !Number.isFinite(started) || !Number.isFinite(finished) || finished < started || JSON.stringify(selection.map(entry => object(entry)?.id)) !== JSON.stringify(PAIRED_COHORT) || JSON.stringify(measurements.map(entry => object(entry)?.id)) !== JSON.stringify(PAIRED_COHORT) || selection.some(entry => !hex(object(entry)?.sha256) || !hex(object(entry)?.goldSha256))) throw new Error("A finalized stable fact-ledger retention report for the fixed synthetic development cohort is required.");
}

export function assertReplayConfiguration(recorded: Identity, current: Identity, variant: FactReplayVariant = "root-alias"): string[] {
  const allowed = variantDetails(variant).files;
  for (const identity of [recorded, current]) {
    const { sha256, ...body } = identity;
    if (sha(JSON.stringify(body)) !== sha256 || new Set(identity.files.map(file => file.file)).size !== identity.files.length) throw new Error("Replay configuration identity is invalid.");
  }
  if (recorded.promptVersion !== PROMPT_VERSION || recorded.promptVersion !== current.promptVersion || recorded.model !== current.model || recorded.chunkFailurePolicy !== current.chunkFailurePolicy || recorded.extractionTransport !== current.extractionTransport || JSON.stringify(recorded.runtime) !== JSON.stringify(current.runtime) || JSON.stringify(recorded.files.map(file => file.file)) !== JSON.stringify(current.files.map(file => file.file))) throw new Error("Replay must preserve the measured prompt, model, runtime and source-file set.");
  const changed = recorded.files.filter((file, index) => file.sha256 !== current.files[index].sha256).map(file => file.file);
  if (changed.some(file => !allowed.includes(file))) throw new Error(variant === "root-alias" ? "Only the fact decoder may differ from the finalized measured configuration." : "Only the fact decoder and tier evidence integration may differ for the explicit tier-range replay.");
  return changed;
}

function safeResult(value: unknown, model: string): AIResult {
  const result = object(value);
  if (!result || result.model !== model || ![result.inputTokens, result.outputTokens, result.elapsedMs].every(number => typeof number === "number" && Number.isFinite(number) && number >= 0) || !(result.costUsd === null || typeof result.costUsd === "string") || !(result.usageAvailable === undefined || typeof result.usageAvailable === "boolean")) throw new ReplayUnavailableError("unavailable_response_metadata");
  return result as unknown as AIResult;
}
/** An eligible saved local rejection may be decoded again. Provider refusals,
 * truncated results retain their recorded interpretation failure without being
 * decoded. Missing/operational failures stop replay. Domain validation runs later. */
export function replaySavedResponse(request: AIRequest, saved: SavedReplayResponse, model: string): AIResult {
  if (request.transport !== "quotation-v8" || request.purpose !== "extraction" || request.chunkFailurePolicy !== options.chunkFailurePolicy) throw new ReplayUnavailableError("wrong_request_contract");
  const rejection = saved.kind === "rejected_record" ? object(saved.value) : null;
  if (saved.kind === "rejected_record" && (!rejection || !["invalid_output", "invalid_evidence"].includes(String(rejection.code)))) throw new ReplayUnavailableError("operational_or_unknown_failure");
  const result = safeResult(rejection ? rejection.result : saved.value, model);
  const unchangedFailure = (reason: string): never => { if (rejection) throw new PreservedReplayRejection(rejection.code as "invalid_output" | "invalid_evidence", result, reason); throw new ReplayUnavailableError(reason); };
  if (result.finishReason === "provider_schema_rejected") unchangedFailure("provider_schema_rejected");
  if (result.providerError) unchangedFailure("provider_error_response");
  if (result.finishReason && result.finishReason !== "stop") unchangedFailure("truncated_or_incomplete_response");
  if (result.finishReason !== "stop") throw new ReplayUnavailableError("unavailable_finish_reason");
  if (result.data === undefined || result.data === null) throw new ReplayUnavailableError("missing_response_data");
  if (saved.kind === "accepted_checkpoint" && result.rejectedAt) throw new ReplayUnavailableError("invalid_accepted_checkpoint");
  if (result.rejectedAt !== "transport") return structuredClone(result);
  let data: unknown = result.data;
  try {
    if (typeof data === "string") data = JSON.parse(data);
    data = compactExtractionRequest(request).restore(data);
  } catch (error) {
    const code = error instanceof ProcessingError && error.code === "invalid_evidence" ? "invalid_evidence" : "invalid_output";
    throw new AIInterpretationError(new ProcessingError(code, "Saved local response still fails offline decoding."), result, true);
  }
  const restored = { ...structuredClone(result), data }; delete restored.rejectedAt;
  return restored;
}

async function readExact(filename: string, maxBytes = 4 * 1024 * 1024): Promise<Buffer> {
  if (await realpath(filename) !== filename) throw new Error("Replay inputs must use their fixed non-redirected paths.");
  const bytes = await readFile(filename); if (bytes.length > maxBytes) throw new Error("Replay input exceeds the bounded inspection limit."); return bytes;
}
async function noFile(filename: string): Promise<void> {
  try { await access(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("Replay requires a finalized source and unused immutable output paths.");
}
function safeScore(score: ReturnType<typeof scoreExtraction>) { return Object.fromEntries(EXTRACTION_METRICS.map(key => [key, score[key]])); }
function interpretationCapture() { return new AIInterpretationError(new ProcessingError("invalid_output", "Offline request capture; no provider response."), { data: null, model: "INJECTED-CAPTURE-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false }, false); }
interface Captured { request: AIRequest; documentId: string; section: number; }

export async function replayDevelopmentFacts(name: string, root = process.cwd(), variant: FactReplayVariant = "root-alias") {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use one finalized development experiment name.");
  const variantInfo = variantDetails(variant);
  assertDevelopmentEnvironment(process.env);
  if (process.env.FIELDOPS_OCR_DATA_DIR) throw new Error("Offline replay cannot redirect its OCR asset directory.");
  root = path.resolve(root); if (await realpath(root) !== root || root !== path.resolve(process.cwd())) throw new Error("Run offline replay from its non-redirected repository root.");
  const publicDirectory = path.join(root, "eval/results/development", name), privateDirectory = path.join(root, "eval/runs/private/development", name, "live-after");
  const reportPath = path.join(publicDirectory, "live-after.json"), outputName = `fact-decoder-replay${variantInfo.suffix}`, outputPath = path.join(publicDirectory, `${outputName}.json`), markdownPath = path.join(publicDirectory, `${outputName}.md`), replayDirectory = path.join(root, "eval/runs/private/development", name, `decoder-replay${variantInfo.suffix}`);
  let reportBytes: Buffer;
  try { reportBytes = await readExact(reportPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("The live report is not finalized; replay stops without polling."); throw error; }
  const report: unknown = JSON.parse(reportBytes.toString("utf8")); assertFactReplayReport(report, name);
  await noFile(path.join(privateDirectory, "run.lock")); await noFile(outputPath); await noFile(markdownPath); await noFile(replayDirectory);
  if (await realpath(publicDirectory) !== publicDirectory || await realpath(privateDirectory) !== privateDirectory) throw new Error("Replay directories must not redirect.");
  // Validate paths before the existing fingerprint helper reads them. No env file
  // or deployment client is loaded; its model identity must already agree.
  for (const file of report.configuration.files) {
    if (!/^(?:package(?:-lock)?\.json|src\/lib\/(?:ai|processing|domain)\/[a-z-]+\.ts|eval\/[a-z-]+\.ts|scripts\/evaluate-development\.ts)$/.test(file.file) || !hex(file.sha256)) throw new Error("Unexpected measured source-file path.");
    await readExact(path.join(root, file.file), 8 * 1024 * 1024);
  }
  const provenance: { path: string; sha256: string }[] = [];
  async function track(filename: string, maximumBytes = 4 * 1024 * 1024) { const bytes = await readExact(filename, maximumBytes); provenance.push({ path: path.relative(root, filename).replaceAll("\\", "/"), sha256: sha(bytes) }); return bytes; }
  const replayCodePath = fileURLToPath(import.meta.url);
  if (replayCodePath !== path.join(root, "scripts/replay-development-facts.ts")) throw new Error("Replay must use the reviewed script in this repository.");
  const replayCodeSha256 = sha(await track(replayCodePath)), auditCodeSha256 = sha(await track(path.join(root, "scripts/audit-development-sections.ts")));
  try { await track(path.join(root, ".fieldops/tessdata/eng.traineddata.gz"), 32 * 1024 * 1024); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const current = await fingerprint(root, options.chunkFailurePolicy, options.extractionTransport), changedFiles = assertReplayConfiguration(report.configuration, current, variant);
  async function scopedJson(filename: string) { const bytes = await readExact(filename); provenance.push({ path: path.relative(root, filename).replaceAll("\\", "/"), sha256: sha(bytes) }); return JSON.parse(bytes.toString("utf8")) as unknown; }
  const manifestPath = path.join(root, "eval/development/gold.json"); await track(manifestPath); const manifest = await readDevelopmentManifest(root);
  const plan = object(await scopedJson(path.join(privateDirectory, "plan.json")));
  if (plan?.configurationHash !== report.configuration.sha256 || JSON.stringify(plan.pair) !== JSON.stringify(report.pair)) throw new Error("The private phase plan does not match its finalized report.");
  const journalPath = path.join(privateDirectory, "usage.jsonl"), journalBytes = await readExact(journalPath);
  provenance.push({ path: path.relative(root, journalPath).replaceAll("\\", "/"), sha256: sha(journalBytes) });
  const events = journalBytes.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as DevelopmentEvent);
  if (events.some(event => !event.documentId || !PAIRED_COHORT.includes(event.documentId) || !["reservation", "response", "failure", "rejection", "quota_wait"].includes(event.kind)) || JSON.stringify(summarizeDevelopmentUsage(events)) !== JSON.stringify(report.observedUsage)) throw new Error("The finalized usage journal does not match its report.");
  const fixtures = PAIRED_COHORT.map(id => { const fixture = manifest.documents.find(document => document.id === id), selected = report.pair.selection.find(document => document.id === id); if (!fixture || fixture.sha256 !== selected?.sha256 || sha(JSON.stringify(fixture)) !== selected.goldSha256) throw new Error("Development source or gold differs from the measured cohort."); return fixture; });
  const parsedDocuments = new Map<string, ParsedDocument>(), captured = new Map<string, Captured>();
  for (const fixture of fixtures) {
    const bytes = await sourceFile(root, fixture), parsed = await parseDocument({ documentId: fixture.id, filename: path.basename(fixture.path), bytes }); parsedDocuments.set(fixture.id, parsed);
    provenance.push({ path: fixture.path.replaceAll("\\", "/"), sha256: sha(bytes) });
    try { await extractQuotation(parsed, { ...options, request: async request => {
      if (request.transport !== "quotation-v8") throw new Error("Reconstructed request transport differs.");
      const key = requestKey(request, report.configuration.model), body = JSON.parse(request.user) as { document: string; section: number };
      if (captured.has(key) || body.document !== fixture.id || !Number.isSafeInteger(body.section)) throw new Error("Reconstructed request identity is ambiguous.");
      captured.set(key, { request, documentId: fixture.id, section: body.section }); throw interpretationCapture();
    } }); throw new Error("Capture unexpectedly produced an interpretation."); }
    catch (error) { if (!(error instanceof ProcessingError) || error.code !== "invalid_output") throw error; }
    if ([...captured.values()].filter(request => request.documentId === fixture.id).length !== extractionChunks(parsed).length) throw new Error("Capture did not traverse the entire source.");
  }
  const saved = new Map<string, SavedReplayResponse>(), listings = new Map<string, string[]>();
  for (const kind of ["requests", "rejected"] as const) {
    const directory = path.join(privateDirectory, kind); let filenames: string[];
    try { if (await realpath(directory) !== directory) throw new Error("Saved response directory redirects."); filenames = (await readdir(directory)).sort(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; filenames = []; }
    if (filenames.length > 100) throw new Error("Saved responses exceed this fixed-cohort replay limit."); listings.set(directory, filenames);
    for (const filename of filenames) {
      const match = (kind === "requests" ? /^([a-f0-9]{64})\.json$/ : /^([a-f0-9]{64})-\d{13}-\d{1,9}\.json$/).exec(filename);
      if (!match || !captured.has(match[1])) throw new Error("A saved response cannot be matched to an exact reconstructed request; no unscoped body was read.");
      const value = await scopedJson(path.join(directory, filename)), artifactSha256 = provenance.at(-1)!.sha256;
      if (saved.has(match[1])) throw new Error("Multiple responses for one request require explicit independent attribution; replay will not cherry-pick.");
      saved.set(match[1], { kind: kind === "requests" ? "accepted_checkpoint" : "rejected_record", value, sha256: artifactSha256 });
    }
  }
  const pendingOutputs: { id: string; quotation: Quotation }[] = [], measurements = [], internalScores: ReturnType<typeof scoreExtraction>[] = [];
  for (const fixture of fixtures) {
    const parsed = parsedDocuments.get(fixture.id)!, attempted = new Set<string>(), validated = new Set<string>(), localRejected = new Set<string>(), preservedFailures = new Map<string, string>(), decoderRejected = new Set<string>(), domainRejected = new Set<string>();
    let quotation: Quotation | null = null, failure: string | null = null;
    try { quotation = await extractQuotation(parsed, { ...options,
      checkpoint: { get: async () => null, set: async key => { if (!attempted.has(key)) throw new Error("Validation observation has the wrong request identity."); validated.add(key); }, reject: async (key, _result, code) => { if (!attempted.has(key)) throw new Error("Rejection observation has the wrong request identity."); if (["invalid_output", "invalid_evidence"].includes(code)) { localRejected.add(key); domainRejected.add(key); } } },
      request: async request => {
        const key = requestKey(request, report.configuration.model), original = captured.get(key); if (!original || original.documentId !== fixture.id || attempted.has(key)) throw new Error("Replay request differs from the exact captured request."); attempted.add(key);
        const response = saved.get(key); if (!response) throw new ReplayUnavailableError("missing_saved_response");
        try { return replaySavedResponse(request, response, report.configuration.model); } catch (error) { if (error instanceof AIInterpretationError) { localRejected.add(key); if (error instanceof PreservedReplayRejection) preservedFailures.set(key, error.reason); else decoderRejected.add(key); } throw error; }
      },
    }); } catch (error) {
      if (error instanceof ReplayUnavailableError) failure = error.reason;
      else if (error instanceof ProcessingError && ["invalid_output", "invalid_evidence"].includes(error.code)) failure = error.code;
      else throw error;
    }
    const score = quotation ? scoreExtraction(fixture, quotation, parsed) : scoreFailedExtraction(fixture); internalScores.push(score);
    const planned = [...captured.entries()].filter(([, request]) => request.documentId === fixture.id), audit = quotation ? auditRetainedQuotation(quotation, parsed) : null;
    if (audit && (!audit.sectionCountsAgree || !audit.originalSourceArrayPreserved || !audit.fieldReferences.allResolvable || !audit.failedTargets.exactPlannedSectionSets || !audit.failedTargets.allRemainBlocking || audit.costGuard.passes === false)) throw new Error("Offline retained-source or price-blocking audit failed.");
    if (quotation) pendingOutputs.push({ id: fixture.id, quotation });
    measurements.push({ id: fixture.id, originalStatus: report.measurements.find(value => value.id === fixture.id)!.status, status: quotation ? quotation.status === "ready" && quotation.manifest.complete ? "complete" : "partial" : "unavailable_or_rejected", failure, score: safeScore(score), readiness: quotation ? auditExtractionReadiness(fixture, quotation, parsed) : null, audit,
      requestCoverage: { planned: planned.length, saved: planned.filter(([key]) => saved.has(key)).length, attempted: attempted.size, validated: validated.size, rejectedSections: localRejected.size, preservedRecordedFailures: preservedFailures.size, decoderStillRejects: decoderRejected.size, domainStillRejects: domainRejected.size, sections: planned.map(([key, request]) => ({ section: request.section, requestSha256: key, artifactSha256: saved.get(key)?.sha256 ?? null, artifactKind: saved.get(key)?.kind ?? null, attempted: attempted.has(key), validated: validated.has(key), outcome: validated.has(key) ? "validated" : preservedFailures.has(key) ? "preserved_recorded_failure" : decoderRejected.has(key) ? "decoder_still_rejects" : domainRejected.has(key) ? "domain_still_rejects" : attempted.has(key) ? "unavailable" : "not_attempted", preservedFailureReason: preservedFailures.get(key) ?? null })) } });
  }
  // Detect changed evidence/configuration before any output. Inputs are never edited.
  for (const input of provenance) if (sha(await readExact(path.join(root, input.path), 32 * 1024 * 1024)) !== input.sha256) throw new Error("Replay input changed during processing.");
  for (const [directory, filenames] of listings) { let final: string[]; try { final = (await readdir(directory)).sort(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; final = []; } if (JSON.stringify(final) !== JSON.stringify(filenames)) throw new Error("Saved response set changed during replay."); }
  if (sha(await readExact(reportPath)) !== sha(reportBytes) || (await fingerprint(root, options.chunkFailurePolicy, options.extractionTransport)).sha256 !== current.sha256) throw new Error("Report or current configuration changed during replay.");
  const output = { version: 1, name, variant, purpose: variantInfo.purpose, replayedAt: new Date().toISOString(), sourceReportSha256: sha(reportBytes), replayCodeSha256, auditCodeSha256, currentConfiguration: current, changedFiles, providerCalls: 0, freshUsage: null, originalCheckpointWrites: 0, originalJournalWrites: 0, heldoutReads: 0, inputArtifacts: provenance,
    before: { configurationHash: report.configuration.sha256, completion: report.completion, fields: report.fields, readiness: report.readiness, observedHistoricalUsage: report.observedUsage },
    after: { completion: { completeDocuments: measurements.filter(value => value.status === "complete").length, partialDocuments: measurements.filter(value => value.status === "partial").length, unavailableOrRejectedDocuments: measurements.filter(value => value.status === "unavailable_or_rejected").length, requestedDocuments: fixtures.length }, fields: aggregateExtractionMetrics(internalScores), readiness: { passingDocuments: measurements.filter(value => value.readiness?.passesSelectedAnnotationGate).length, requestedDocuments: fixtures.length, auditedOutputs: pendingOutputs.length,
      correctCriticalFields: { numerator: measurements.reduce((sum, value) => sum + (value.readiness?.correctCriticalStatedFields.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state === "value").length, 0) },
      evidenceBackedCriticalFields: { numerator: measurements.reduce((sum, value) => sum + (value.readiness?.evidenceBackedCriticalStatedFields.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state === "value").length, 0) },
      correctCriticalNonValueStates: { numerator: measurements.reduce((sum, value) => sum + (value.readiness?.correctCriticalNonValueStates.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state !== "value").length, 0) },
      sourceLinkedCriticalNonValueStates: { numerator: measurements.reduce((sum, value) => sum + (value.readiness?.sourceLinkedCriticalNonValueStates.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state !== "value").length, 0) },
      completeExpectedItems: { numerator: measurements.reduce((sum, value) => sum + (value.readiness?.completeExpectedItems.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.quotation.items.length, 0) },
    }, measurements },
    limitations: ["Post-hoc decoding of the same development responses, not a new model generation, independent evaluation or held-out result.", `${variant === "tier-range" ? "Only fact-transport.ts and index.ts may differ for this explicit tier-range variant; the default root-alias variant still prohibits index.ts drift." : "Only the fact-decoder source may differ."} Exact original request hashes still bind model, prompt, schema and source records. No rejected value, syntax, citation or quotation is repaired by this tool.`, "Accepted expanded checkpoints and eligible stop-finished local rejections pass current domain validation. Provider-schema rejection and truncation with recorded invalid_output/evidence retain their original failed-section behavior without decoding. Missing/unattributable responses and operational failures stop that document. None are revived or replaced.", "All three documents and expected annotations remain in metric denominators. Unavailable replay documents earn no extraction credit; partial output is scored as partial availability.", "Private quotation usage/timestamps describe replayed response metadata and local reconstruction. There is no fresh provider latency, token usage or cost measurement; historical usage remains separately labelled.", "Source-reference resolution and location agreement do not prove semantic entailment. Strict readiness v4 intentionally leaves unverified charge absence unresolved.", "No original checkpoint, journal, report or quotation is overwritten. Replayed quotations remain private; public output contains only fixed identifiers, hashes, aggregate metrics and static audit diagnostics."] };
  await mkdir(replayDirectory); if (await realpath(replayDirectory) !== replayDirectory) throw new Error("Replay output directory redirected.");
  for (const item of pendingOutputs) await writeImmutableJson(path.join(replayDirectory, `${item.id}.json`), item.quotation);
  await writeImmutableJson(outputPath, output);
  await writeFile(markdownPath, `# Offline fact-decoder replay\n\nVariant: \`${variant}\`. ${variantInfo.purpose}\n\nFinalized source report SHA-256: \`${output.sourceReportSha256}\`. Replay code SHA-256: \`${replayCodeSha256}\`. Provider calls: 0.\n\n| Document | Original live result | Offline replay | Validated / planned sections |\n|---|---|---|---:|\n${measurements.map(value => `| ${value.id} | ${value.originalStatus} | ${value.status} | ${value.requestCoverage.validated}/${value.requestCoverage.planned} |`).join("\n")}\n\n${output.limitations.map(value => `- ${value}`).join("\n")}\n\n[Immutable sanitized replay report](${outputName}.json).\n`, { flag: "wx" });
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseFactReplayArguments(process.argv.slice(2));
    replayDevelopmentFacts(args.name, process.cwd(), args.variant).then(() => console.log("Immutable offline fact replay written; no provider calls.")).catch(() => { console.error("Offline replay stopped: verify finalized scope, recorded artifacts and variant-specific configuration. Raw response contents were not logged."); process.exitCode = 1; });
  } catch { console.error("Use --name <finalized-development-experiment> [--variant tier-range]."); process.exitCode = 1; }
}
