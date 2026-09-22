import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import type { FixtureRecord } from "./generate-fixtures";
import { parseDocument } from "../src/lib/processing";
import { ocrDataDirectory } from "../src/lib/processing/ocr";
import { extractQuotation, requestAI, requireLiveAI, liveAIConfiguration, PROMPT_VERSION, type AIResult, type AICheckpoint } from "../src/lib/ai";
import type { ParsedDocument, Quotation } from "../src/lib/domain/types";
import { parserMetrics, scoreExtraction, scoreFailedExtraction, aggregateExtractionMetrics, type Fraction } from "../eval/metrics";
import { assertDevelopmentEnvironment, assertDevelopmentIds, developmentRequestController, parseDevelopmentOptions, responseEvent, summarizeDevelopmentUsage, unsourcedMissingStateAgreements, unattemptedDevelopmentScore, type DevelopmentOptions, type DevelopmentEvent } from "../eval/development-control";
import { errorCode } from "../eval/live-control";
import { auditExtractionReadiness } from "../eval/readiness";
import { ProviderSchemaError, type ProviderSchemaDiagnostic } from "../src/lib/ai/provider-error";
import { aiRequestKey, groqModelProfile } from "../src/lib/ai/groq";
import { acquireModelStudyBudget, assertComparableModelConfigurations, MODEL_STUDY_METRIC_VERSION, MODEL_STUDY_PROTOCOL_VERSION } from "../eval/model-study-control";
import { developmentOutcomes, persistDevelopmentQuotation } from "../eval/development-outcomes";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const JSON_TEXT = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const FILES = ["package.json", "package-lock.json", "src/lib/ai/index.ts", "src/lib/ai/schema.ts", "src/lib/ai/groq.ts", "src/lib/ai/transport.ts", "src/lib/ai/typed-transport.ts", "src/lib/ai/provider-schema.ts", "src/lib/ai/completeness.ts", "src/lib/ai/chunks.ts", "src/lib/processing/index.ts", "src/lib/processing/ocr.ts", "src/lib/processing/errors.ts", "src/lib/domain/types.ts", "src/lib/domain/corrections.ts", "src/lib/domain/matching.ts", "src/lib/domain/calculate.ts", "src/lib/domain/numeric.ts", "src/lib/domain/billing.ts", "src/lib/domain/decisions.ts", "src/lib/domain/validation.ts", "eval/metrics.ts", "eval/readiness.ts", "eval/charge-alignment.ts", "eval/live-control.ts", "eval/development-control.ts", "scripts/evaluate-development.ts"];
type DevelopmentManifest = { version: string; rights: string; verification: string; split: "dev"; documents: FixtureRecord[]; robustness: [] };
export async function readDevelopmentManifest(root: string): Promise<DevelopmentManifest> {
  // This runner never opens the combined gold, held-out records, or robustness files.
  const filename = path.join(root, "eval/development/gold.json");
  if (await realpath(filename) !== filename) throw new Error("The development manifest must not redirect.");
  const manifest = JSON.parse(await readFile(filename, "utf8")) as DevelopmentManifest;
  if (manifest.split !== "dev" || !Array.isArray(manifest.documents) || !Array.isArray(manifest.robustness) || manifest.robustness.length || !manifest.rights.includes("self-authored")) throw new Error("A separately authored development-only fixture manifest is required.");
  assertDevelopmentIds(manifest.documents.map(document => document.id));
  if (manifest.documents.some(document => document.split !== "dev")) throw new Error("Non-development records are prohibited, even when not selected.");
  return manifest;
}
export async function loadDevelopmentEnvironment(root: string, file: ".env.ai.local" | undefined, model?: DevelopmentOptions["model"]): Promise<void> {
  assertDevelopmentEnvironment(process.env);
  if (file) {
    if (file !== ".env.ai.local") throw new Error("Only .env.ai.local may be loaded.");
    const filename = path.join(root, file);
    if (await realpath(filename) !== filename) throw new Error("The dedicated environment file must not redirect to another file.");
    const values = parseEnv(await readFile(filename, "utf8"));
    assertDevelopmentEnvironment(values);
    for (const key of ["GROQ_API_KEY", "GROQ_MODEL", "GROQ_FREE_TIER_CONFIRMED", "GROQ_ZDR_CONFIRMED", "FIELDOPS_PROCESSING_MODE"]) {
      if (values[key] !== undefined) process.env[key] = values[key];
    }
  }
  if (model) { if (!["openai/gpt-oss-120b", "qwen/qwen3.8-27b"].includes(model)) throw new Error("Unsupported development model."); process.env.GROQ_MODEL = model; }
  requireLiveAI({ allowPreviewModel: Boolean(model) });
}
export async function sourceFile(root: string, fixture: FixtureRecord): Promise<Buffer> {
  assertDevelopmentIds([fixture.id]);
  const extension = ({ text_pdf: "pdf", scan_pdf: "pdf", png: "png", xlsx: "xlsx", csv: "csv", text: "txt" } as const)[fixture.format];
  if (!extension) throw new Error("Unsupported development fixture format.");
  const expectedBase = path.join(root, "eval/originals/dev");
  const expectedFile = path.join(expectedBase, `${fixture.id}.${extension}`);
  const base = await realpath(expectedBase);
  const filename = await realpath(expectedFile);
  const relative = path.relative(base, filename);
  if (base !== expectedBase || filename !== expectedFile || relative.startsWith("..") || path.isAbsolute(relative) || path.resolve(root, fixture.path) !== expectedFile) throw new Error("Development originals must use their fixed non-redirected fixture path.");
  const bytes = await readFile(filename);
  if (digest(bytes) !== fixture.sha256 || bytes.length !== fixture.sizeBytes) throw new Error(`Development original hash mismatch: ${fixture.id}.`);
  return bytes;
}
export async function fingerprint(root: string, chunkFailurePolicy: DevelopmentOptions["chunkFailurePolicy"] = "reject_document", extractionTransport: DevelopmentOptions["extractionTransport"] = "legacy_v5", modelStudy?: { model: NonNullable<DevelopmentOptions["model"]> }) {
  let ocrSha256: string | null = null;
  try { ocrSha256 = digest(await readFile(path.join(ocrDataDirectory(), "eng.traineddata.gz"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const files = await Promise.all([...FILES, "src/lib/ai/partitioned-transport.ts", "src/lib/ai/provider-error.ts", "src/lib/ai/fact-transport.ts", "src/lib/ai/dates.ts", ...(extractionTransport === "focused_fields_v1" ? ["src/lib/ai/focused-transport.ts"] : []), ...(modelStudy ? ["eval/model-study-control.ts", "eval/development-outcomes.ts", "scripts/preflight-development.ts", "scripts/compare-development.ts"] : [])].map(async file => ({ file, sha256: digest(await readFile(path.join(root, file))) })));
  const model = modelStudy?.model ?? liveAIConfiguration().model;
  const identity = { promptVersion: PROMPT_VERSION, model, chunkFailurePolicy, extractionTransport, ...(modelStudy ? { comparisonKind: "model" as const, modelStudyProtocolVersion: MODEL_STUDY_PROTOCOL_VERSION, modelProfile: groqModelProfile(model), allowPreviewModel: true, maxTransportAttempts: 1 as const } : {}), runtime: { node: process.version, platform: process.platform, architecture: process.arch, ocrSha256 }, files };
  return { ...identity, sha256: digest(JSON.stringify(identity)) };
}
async function optionalJson<T>(filename: string): Promise<T | null> { try { return JSON.parse(await readFile(filename, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
/** Exclusive creation is deliberate: reports and accepted checkpoints cannot be replaced by a rerun. */
export async function writeImmutableJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const handle = await open(filename, "wx");
  try { await handle.writeFile(JSON_TEXT(value)); await handle.sync(); } finally { await handle.close(); }
}
async function recordEvent(filename: string, event: DevelopmentEvent): Promise<void> {
  const handle = await open(filename, "a");
  try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); } finally { await handle.close(); }
}
const display = (metric: Fraction) => metric.value === null ? `unavailable (${metric.numerator}/${metric.denominator})` : `${(100 * metric.value).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;

export async function evaluateDevelopment(options: DevelopmentOptions, root = process.cwd()) {
  // Revalidate callers as well as CLI flags before credentials, original bytes or models.
  const checked = parseDevelopmentOptions(["--name", options.name, "--phase", options.phase, "--documents", options.documentIds.join(","), "--max-requests", String(options.maxRequests), "--max-reserved-tokens", String(options.maxReservedTokens), "--max-wait-ms", String(options.maxWaitMs), "--chunk-failure-policy", options.chunkFailurePolicy ?? "reject_document", "--extraction-transport", options.extractionTransport ?? "legacy_v5", ...(options.live ? ["--live"] : []), ...(options.envFile ? ["--env-file", options.envFile] : []), ...(options.baselineName ? ["--baseline-name", options.baselineName] : []), ...(options.comparisonKind ? ["--comparison-kind", options.comparisonKind] : []), ...(options.model ? ["--model", options.model] : [])]);
  assertDevelopmentEnvironment(process.env);
  const manifest = await readDevelopmentManifest(root);
  const fixtures = checked.documentIds.map(id => { const fixture = manifest.documents.find(document => document.id === id); if (!fixture) throw new Error("Selected development original is missing."); return fixture; });
  const mode = checked.live ? "live" : "baseline";
  const publicDirectory = path.join(root, "eval/results/development", checked.name);
  for (const phase of ["before", "after"]) {
    try { await access(path.join(publicDirectory, `interrupted-${phase}.json`)); throw new Error("This study was sealed as interrupted and cannot resume. Use a new named study; its evidence and locks remain intact."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const reportPath = path.join(publicDirectory, `${mode}-${checked.phase}.json`);
  try { await access(reportPath); throw new Error("This named phase already has an immutable report; use a new experiment name."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (checked.live) await loadDevelopmentEnvironment(root, checked.envFile, checked.model);
  const modelStudy = checked.comparisonKind === "model" ? { model: checked.model! } : undefined;
  const identity = await fingerprint(root, checked.chunkFailurePolicy, checked.extractionTransport, modelStudy);
  const selection = fixtures.map(fixture => ({ id: fixture.id, format: fixture.format, sha256: fixture.sha256, goldSha256: digest(JSON.stringify(fixture)) }));
  const limits = { maxRequests: checked.maxRequests, maxReservedTokens: checked.maxReservedTokens, maxWaitMs: checked.maxWaitMs };
  const pair = { mode, split: "dev", selection, limits, metricVersion: modelStudy ? MODEL_STUDY_METRIC_VERSION : "fieldops-development-1", synthetic: true, ...(modelStudy ? { comparisonKind: "model" as const, modelStudyProtocolVersion: MODEL_STUDY_PROTOCOL_VERSION, models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"], maxTransportAttempts: 1 } : {}) };
  let preflightSha256: string | undefined;
  if (modelStudy) {
    const preflightPath = path.join(publicDirectory, "offline-preflight.json");
    if (await realpath(preflightPath) !== preflightPath) throw new Error("The model-study preflight must not redirect.");
    const bytes = await readFile(preflightPath), preflight = JSON.parse(bytes.toString("utf8"));
    const captured = preflight.models?.find((candidate: { configuration: { model: string } }) => candidate.configuration.model === checked.model);
    if (preflight.comparisonKind !== "model" || preflight.name !== checked.name || !preflight.configurationStableDuringRun || !preflight.fits || !captured || captured.configuration.sha256 !== identity.sha256 || JSON.stringify(preflight.selection) !== JSON.stringify(selection) || captured.reservation.attemptSlots > limits.maxRequests || captured.reservation.estimatedTokens > limits.maxReservedTokens || captured.reservation.nominalPacingMs + 60000 > limits.maxWaitMs || captured.reservation.maxSingleAttemptEstimatedTokens > 7500) throw new Error("A stable full-cohort model preflight matching this exact code/model and phase budget is required.");
    preflightSha256 = digest(bytes);
  }
  let baselineReference: { name: string; report: string; sha256: string; configurationHash: string; measuredAt: string; model: string } | undefined;
  if (checked.phase === "after") {
    const baselineName = checked.baselineName ?? checked.name;
    const baselinePath = path.join(root, "eval/results/development", baselineName, `${mode}-before.json`);
    if (await realpath(baselinePath) !== baselinePath) throw new Error("The baseline report must not redirect to another file.");
    const bytes = await readFile(baselinePath);
    const before = JSON.parse(bytes.toString("utf8")) as { name: string; mode: string; phase: string; pair: typeof pair; configurationStableDuringRun: boolean; configuration: Awaited<ReturnType<typeof fingerprint>>; measuredAt: string };
    if (before.name !== baselineName || before.mode !== mode || before.phase !== "before" || !before.configurationStableDuringRun || JSON.stringify(before.pair) !== JSON.stringify(pair)) throw new Error("After requires a finalized before report with the identical ordered cohort, source/gold hashes, mode and budgets.");
    if (modelStudy) assertComparableModelConfigurations(before.configuration, identity);
    else if (before.configuration.model !== identity.model) throw new Error("Changing models requires explicit model comparison mode.");
    if (checked.baselineName) {
      if (before.configuration.model !== identity.model) throw new Error("A referenced baseline requires the same configured model.");
      baselineReference = { name: baselineName, report: `eval/results/development/${baselineName}/${mode}-before.json`, sha256: digest(bytes), configurationHash: before.configuration.sha256, measuredAt: before.measuredAt, model: before.configuration.model };
    }
  }
  // Verify every selected original before the first model request, including later documents.
  const originals = await Promise.all(fixtures.map(fixture => sourceFile(root, fixture)));
  const privateDirectory = path.join(root, "eval/runs/private/development", checked.name, `${mode}-${checked.phase}`);
  await mkdir(privateDirectory, { recursive: true });
  const lockPath = path.join(privateDirectory, "run.lock");
  let sharedBudget: Awaited<ReturnType<typeof acquireModelStudyBudget>> | undefined;
  let lock;
  try { lock = await open(lockPath, "wx"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("This phase is running or was interrupted. Verify its process has stopped before removing only this phase's run.lock."); throw error; }
  try {
    await lock.writeFile(JSON_TEXT({ pid: process.pid, startedAt: new Date().toISOString() }));
    const plan = { pair, configurationHash: identity.sha256, ...(baselineReference ? { baselineReference } : {}), ...(preflightSha256 ? { preflightSha256 } : {}) };
    const planPath = path.join(privateDirectory, "plan.json"), previousPlan = await optionalJson(planPath);
    if (previousPlan && JSON.stringify(previousPlan) !== JSON.stringify(plan)) throw new Error("An interrupted phase can resume only with identical code, model, runtime, originals and budgets.");
    if (!previousPlan) await writeImmutableJson(planPath, plan);
    if (baselineReference) {
      const referencePath = path.join(publicDirectory, "baseline-reference.json");
      const previousReference = await optionalJson(referencePath);
      if (previousReference && JSON.stringify(previousReference) !== JSON.stringify(baselineReference)) throw new Error("The immutable baseline reference changed.");
      if (!previousReference) await writeImmutableJson(referencePath, baselineReference);
    }
    const journalPath = path.join(privateDirectory, "usage.jsonl");
    let events: DevelopmentEvent[];
    try { events = (await readFile(journalPath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as DevelopmentEvent); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; events = []; }
    const outcomes = modelStudy ? await developmentOutcomes({ directory: privateDirectory, configurationHash: identity.sha256, model: identity.model }) : undefined;
    const recovery = outcomes ? await outcomes.recover(events, event => recordEvent(journalPath, event)) : undefined;
    if (modelStudy) sharedBudget = await acquireModelStudyBudget({ root, name: checked.name, phase: checked.phase, configurationHash: identity.sha256, allocationTokens: limits.maxReservedTokens });
    let activeDocument = fixtures[0].id;
    const persist = async (event: DevelopmentEvent) => {
      const annotated = { ...(sharedBudget ? await sharedBudget.annotate(event) : event), documentId: activeDocument };
      if (outcomes && event.kind === "reservation") await outcomes.reserve(annotated);
      await recordEvent(journalPath, annotated);
    };
    const record = async (event: DevelopmentEvent) => { await persist(event); events.push(event); };
    const checkpoint: AICheckpoint = {
      get: async key => { await outcomes?.rejectIfSettled(key); return optionalJson<AIResult>(path.join(privateDirectory, "requests", `${key}.json`)); },
      set: async (key, result) => {
        const filename = path.join(privateDirectory, "requests", `${key}.json`);
        // Validated reuse leaves the original successful checkpoint intact.
        if (!await optionalJson(filename)) await writeImmutableJson(filename, result);
      },
      reject: async (key, result, code, context) => {
        await outcomes?.reject(key, result, code, context?.cached ?? false, activeDocument);
        await writeImmutableJson(path.join(privateDirectory, "rejected", `${key}-${Date.now()}-${events.length}.json`), { code, cached: context?.cached ?? false, result });
        if (!context?.cached && result.rejectedAt === "transport") await record({ ...responseEvent(result), ...(modelStudy ? { requestKey: key } : {}) });
        await record({ kind: "rejection", at: new Date().toISOString(), code, cached: context?.cached ?? false, ...(modelStudy ? { requestKey: key } : {}) });
      },
    };
    const studyAIOptions = modelStudy ? { allowPreviewModel: true, maxTransportAttempts: 1 as const } : {};
    const provider = (request: Parameters<typeof requestAI>[0], context?: { signal?: AbortSignal }) => requestAI(request, { ...context, checkpoint, ...studyAIOptions });
    const controller = developmentRequestController({ limits, events, persist, ...(modelStudy ? { maxTransportAttempts: 1 as const, retryQuota: false, durableWaits: true, requestKey: request => aiRequestKey(request, identity.model), lastSharedActivity: sharedBudget!.lastActivity } : {}), request: outcomes ? outcomes.dispatch(provider) : provider });
    const resumableRequest = outcomes ? outcomes.wrap(controller.request) : controller.request;
    type Measurement = { id: string; status: "not_attempted" | "parser_failed" | "parsed_only" | "rejected" | "partial" | "complete"; errorCode?: string; schemaDiagnostic?: ProviderSchemaDiagnostic; parser?: ReturnType<typeof parserMetrics>; parserElapsedMs?: number; extractionElapsedMs?: number; score?: ReturnType<typeof scoreExtraction>; readiness?: ReturnType<typeof auditExtractionReadiness>; unresolvedIssues?: number; unsourcedMatchingMissingStates?: number; retainedOutput?: Awaited<ReturnType<typeof persistDevelopmentQuotation>> };
    const measurements: Measurement[] = [];
    const sessionStartedAt = new Date().toISOString(), started = performance.now();
    const timingPath = path.join(privateDirectory, "phase-start.json");
    let phaseStart = modelStudy ? await optionalJson<{ startedAt: string }>(timingPath) : null;
    if (modelStudy && !phaseStart) { phaseStart = { startedAt: sessionStartedAt }; await writeImmutableJson(timingPath, phaseStart); }
    if (phaseStart && !Number.isFinite(Date.parse(phaseStart.startedAt))) throw new Error("Invalid original phase timing receipt.");
    const startedAt = phaseStart?.startedAt ?? sessionStartedAt;
    if (modelStudy) await writeImmutableJson(path.join(privateDirectory, "sessions", `${Date.now()}-${randomUUID()}.json`), { startedAt: sessionStartedAt, recoveredJournalEvents: recovery?.recoveredEvents ?? 0 });
    for (let index = 0; index < fixtures.length; index++) {
      const fixture = fixtures[index]; activeDocument = fixture.id;
      if (controller.halt) { measurements.push({ id: fixture.id, status: "not_attempted", errorCode: controller.halt, ...(modelStudy ? { score: unattemptedDevelopmentScore(fixture, checked.comparisonKind) } : {}) }); continue; }
      const parserStart = performance.now(); let parsed: ParsedDocument;
      try { parsed = await parseDocument({ documentId: fixture.id, filename: path.basename(fixture.path), bytes: originals[index] }); }
      catch (error) { measurements.push({ id: fixture.id, status: "parser_failed", errorCode: errorCode(error), parserElapsedMs: performance.now() - parserStart, ...(checked.live ? { score: scoreFailedExtraction(fixture) } : {}) }); continue; }
      const measurement: Measurement = { id: fixture.id, status: "parsed_only", parser: parserMetrics(fixture, parsed), parserElapsedMs: performance.now() - parserStart };
      measurements.push(measurement);
      if (!checked.live) continue;
      const extractionStart = performance.now();
      try {
        // Always revalidate request checkpoints; never bypass validation with a saved quotation.
        // Structural assignment also permits original-implementation worktree
        // reproduction: legacy AIOptions ignores this additional optional field.
        const extractionOptions = { checkpoint, request: resumableRequest, chunkFailurePolicy: checked.chunkFailurePolicy, extractionTransport: checked.extractionTransport, ...studyAIOptions };
        const quotation: Quotation = await extractQuotation(parsed, extractionOptions);
        measurement.status = quotation.status === "ready" && quotation.manifest.complete ? "complete" : "partial";
        measurement.score = scoreExtraction(fixture, quotation, parsed);
        measurement.readiness = auditExtractionReadiness(fixture, quotation, parsed);
        measurement.unsourcedMatchingMissingStates = unsourcedMissingStateAgreements(fixture, quotation, measurement.score.mappedItems);
        measurement.unresolvedIssues = quotation.issues.filter(issue => !issue.resolved).length;
        if (modelStudy) measurement.retainedOutput = await persistDevelopmentQuotation(privateDirectory, fixture.id, quotation);
        else await writeImmutableJson(path.join(privateDirectory, "outputs", `${fixture.id}-${Date.now()}.json`), quotation);
      } catch (error) { measurement.status = "rejected"; measurement.errorCode = errorCode(error); if (error instanceof ProviderSchemaError) measurement.schemaDiagnostic = error.diagnostic; measurement.score = scoreFailedExtraction(fixture); if (modelStudy && !["invalid_output", "invalid_evidence"].includes(measurement.errorCode)) controller.stop(measurement.errorCode); }
      measurement.extractionElapsedMs = performance.now() - extractionStart;
      console.log(`${fixture.id}: ${measurement.status}${measurement.errorCode ? ` (${measurement.errorCode})` : ""}`);
    }
    const finalIdentity = await fingerprint(root, checked.chunkFailurePolicy, checked.extractionTransport, modelStudy);
    const report = {
      version: 1, name: checked.name, phase: checked.phase, mode, pair, ...(baselineReference ? { baselineReference } : {}),
      startedAt, measuredAt: new Date().toISOString(), elapsedMs: modelStudy ? Date.now() - Date.parse(startedAt) : performance.now() - started,
      ...(modelStudy ? { executionTiming: { originalPhaseStartedAt: startedAt, currentSessionStartedAt: sessionStartedAt, currentSessionElapsedMs: performance.now() - started, sessionCount: (await readdir(path.join(privateDirectory, "sessions"))).length, scope: "Phase elapsed time includes interruptions, resumes and quota pacing. Per-document durations in this report include revalidation of saved responses; they are not fresh-generation latency." } } : {}),
      configuration: identity, configurationStableDuringRun: finalIdentity.sha256 === identity.sha256,
      ...(sharedBudget ? { modelStudyBudget: { admission: sharedBudget.admission, atCompletion: sharedBudget.current(), preflightSha256, noAutomaticRetries: true } } : {}),
      dataset: { requestedDocuments: fixtures.length, logicalItems: fixtures.reduce((sum, fixture) => sum + fixture.quotation.items.length, 0), annotatedFields: fixtures.reduce((sum, fixture) => sum + fixture.fields.length, 0), formats: selection.map(document => document.format), synthetic: true, split: "dev", heldoutDocumentsRead: 0, heldoutModelCalls: 0 },
      completion: { completeDocuments: measurements.filter(measurement => measurement.status === "complete").length, partialDocuments: measurements.filter(measurement => measurement.status === "partial").length, rejectedDocuments: measurements.filter(measurement => measurement.status === "rejected").length, parserFailures: measurements.filter(measurement => measurement.status === "parser_failed").length, unattemptedDocuments: measurements.filter(measurement => measurement.status === "not_attempted").length, halted: controller.halt },
      fields: checked.live ? aggregateExtractionMetrics(measurements.flatMap(measurement => measurement.score ? [measurement.score] : [])) : null,
      readiness: { passingDocuments: measurements.filter(measurement => measurement.readiness?.passesSelectedAnnotationGate).length, requestedDocuments: fixtures.length, auditedOutputs: measurements.filter(measurement => measurement.readiness).length,
        correctCriticalFields: { numerator: measurements.reduce((sum, measurement) => sum + (measurement.readiness?.correctCriticalStatedFields.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state === "value").length, 0) },
        evidenceBackedCriticalFields: { numerator: measurements.reduce((sum, measurement) => sum + (measurement.readiness?.evidenceBackedCriticalStatedFields.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state === "value").length, 0) },
        correctCriticalNonValueStates: { numerator: measurements.reduce((sum, measurement) => sum + (measurement.readiness?.correctCriticalNonValueStates.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state !== "value").length, 0) },
        sourceLinkedCriticalNonValueStates: { numerator: measurements.reduce((sum, measurement) => sum + (measurement.readiness?.sourceLinkedCriticalNonValueStates.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.fields.filter(field => field.critical && field.state !== "value").length, 0) },
        completeExpectedItems: { numerator: measurements.reduce((sum, measurement) => sum + (measurement.readiness?.completeExpectedItems.numerator ?? 0), 0), denominator: fixtures.reduce((sum, fixture) => sum + fixture.quotation.items.length, 0) },
        scope: "Separate selected-annotation quality gate; application complete/ready status and identifier-only row recall are insufficient. Rejected and unattempted documents do not pass and remain in the fixed quality denominators. Critical non-value states must agree without synthesizing absent containers; not_stated is absence of assertion, not verified absence. Source-linked non-value counts are separate diagnostics. No claim of unannotated semantic correctness or held-out reliability." },
      missingStateAudit: { unsourcedMatchingStates: measurements.reduce((sum, measurement) => sum + (measurement.unsourcedMatchingMissingStates ?? 0), 0), scope: "Historical missing-state scoring is unchanged. A matching not-stated/not-applicable/ambiguous default without source evidence is not verified absence, especially after rejected sections. Inspect this diagnostic separately from accuracy." },
      observedUsage: { ...summarizeDevelopmentUsage(events), ...(modelStudy ? { scope: "One attempt per dispatch with no automatic retry. Whole-phase estimated reservations are additionally charged to the shared UTC-day ledger; unknown usage is never refunded. Returned token totals exclude unavailable usage and are not measured billing or account-wide remaining quota." } : {}) }, measurements,
      limitations: ["Development-only adaptive evidence; no held-out or general supplier-format accuracy claim.", "All complete selected documents are supplied; no cropped successful section is substituted for a quotation.", "Field metrics include partial accepted output. Rejected attempted documents earn zero credit; unattempted documents are counted separately. Zero source/precision denominators mean unavailable.", "Item alignment uses exact identifiers. Source reference resolvability and location agreement are narrower than independent semantic correctness.", "Matching and arithmetic are not remeasured by this extraction-only cohort. No model matching calls are made.", "A complete extraction status does not imply every field is correct or every review issue resolved. Inspect accuracy denominators and issues.", "Code/runtime drift during execution invalidates a paired causal comparison and is exposed explicitly.", "This executable imports no deployment client and makes no production writes. Its environment guard is defense in depth, not an audit of other simultaneously running processes."],
    };
    await writeImmutableJson(reportPath, report);
    const markdown = `# ${checked.name}: ${mode} ${checked.phase}\n\nMeasured ${report.measuredAt}. Three-part identity: named phase, selected source/gold hashes and configuration SHA-256 \`${identity.sha256}\`. Code stable during run: ${report.configurationStableDuringRun}.\n\n${fixtures.length} complete synthetic development originals; ${report.dataset.logicalItems} logical items; ${report.dataset.annotatedFields} field assertions. Held-out reads/model calls: 0/0.\n\n| Document | Result | Parser ms | Extraction ms |\n|---|---|---:|---:|\n${measurements.map(measurement => `| ${measurement.id} | ${measurement.status}${measurement.errorCode ? `: ${measurement.errorCode}` : ""} | ${Math.round(measurement.parserElapsedMs ?? 0)} | ${measurement.extractionElapsedMs === undefined ? "not run" : Math.round(measurement.extractionElapsedMs)} |`).join("\n")}\n\nComplete ${report.completion.completeDocuments}/${fixtures.length}; partial ${report.completion.partialDocuments}; rejected ${report.completion.rejectedDocuments}; unattempted ${report.completion.unattemptedDocuments}. ${checked.live ? "Complete means the application accepted coverage; accuracy is scored separately." : "Offline parser run; no AI extraction was performed."}\n\n${report.fields ? `| Extraction measurement | Result |\n|---|---|\n${Object.entries(report.fields).map(([key, metric]) => `| ${key} | ${display(metric)} |`).join("\n")}\n\n` : ""}Returned responses ${report.observedUsage.returnedResponses}, without usage ${report.observedUsage.responsesWithoutUsage}; known input/output tokens ${report.observedUsage.inputTokens}/${report.observedUsage.outputTokens}. Reserved attempt slots ${report.observedUsage.reservedAttemptSlots}/${limits.maxRequests}, estimated tokens ${report.observedUsage.reservedTokens}/${limits.maxReservedTokens}. ${report.observedUsage.scope}\n\n${report.limitations.map(limitation => `- ${limitation}`).join("\n")}\n\n[Machine-readable report](${mode}-${checked.phase}.json). Existing public benchmark and latest reports are unchanged.\n`;
    const policyNote = `\nExtraction transport: \`${checked.extractionTransport}\`. Chunk failure policy: \`${checked.chunkFailurePolicy}\`. Retaining valid chunks measures partial availability; it does not imply complete extraction or improved model generation. Annotated matching missing states without source evidence: ${report.missingStateAudit.unsourcedMatchingStates}. ${report.missingStateAudit.scope}\n\nSelected-annotation quality gate: ${report.readiness.passingDocuments}/${report.readiness.requestedDocuments} documents pass; ${report.readiness.auditedOutputs} outputs audited. ${report.readiness.scope}\n`;
    await writeFile(path.join(publicDirectory, `${mode}-${checked.phase}.md`), markdown + policyNote + (baselineReference ? `\nOriginal baseline: [${baselineReference.name}](../${baselineReference.name}/live-before.json), measured ${baselineReference.measuredAt}; report SHA-256 \`${baselineReference.sha256}\`. The baseline was referenced without rerunning or copying it.\n` : ""), { flag: "wx" });
    console.log(`Immutable development report: eval/results/development/${checked.name}/${mode}-${checked.phase}.json`);
    return report;
  } finally { await sharedBudget?.close(); await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  evaluateDevelopment(parseDevelopmentOptions(process.argv.slice(2))).catch(error => {
    console.error(error instanceof Error ? error.message : "Development evaluation failed."); process.exitCode = 1;
  });
}
