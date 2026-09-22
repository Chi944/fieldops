import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseDocument, ProcessingError } from "../src/lib/processing";
import { extractQuotation, extractionChunks, type AIRequest, type AIResult } from "../src/lib/ai";
import { planFocusedExtraction } from "../src/lib/ai/focused-transport";
import { assertDevelopmentEnvironment, PAIRED_COHORT, requestReservation, type DevelopmentOptions } from "../eval/development-control";
import { inspectModelStudyBudget, MODEL_STUDY_PROTOCOL_VERSION } from "../eval/model-study-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson } from "./evaluate-development";

export async function captureDevelopmentRequests(root: string, extractionTransport: DevelopmentOptions["extractionTransport"], model?: NonNullable<DevelopmentOptions["model"]>) {
  const manifest = await readDevelopmentManifest(root);
  const documents = [];
  for (const id of PAIRED_COHORT) {
    const fixture = manifest.documents.find(document => document.id === id);
    if (!fixture) throw new Error("The fixed development cohort is incomplete.");
    const bytes = await sourceFile(root, fixture);
    const parsed = await parseDocument({ documentId: id, filename: path.basename(fixture.path), bytes });
    const planned = extractionTransport === "focused_fields_v1" ? planFocusedExtraction(parsed) : extractionChunks(parsed);
    const requests: { section: number; task?: string; targetSourceCount: number; contextSourceCount: number; attemptSlots: number; reservedTokens: number }[] = [];
    const targetIds = new Set<string>();
    const request = async (input: AIRequest): Promise<AIResult> => {
      const body = JSON.parse(input.user) as { section: number; task?: string; sources: { id: string }[]; context?: { id: string }[] };
      body.sources.forEach(source => { if (targetIds.has(source.id)) throw new Error("A target source occurs in multiple planned chunks."); targetIds.add(source.id); });
      requests.push({ section: body.section, ...(body.task ? { task: body.task } : {}), targetSourceCount: body.sources.length, contextSourceCount: body.context?.length ?? 0, ...requestReservation(input, model ? 1 : 2) });
      return { data: { injectedPreflightInvalid: true }, model: "INJECTED-PREFLIGHT-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
    };
    const extractionOptions = { request, chunkFailurePolicy: "retain_valid_chunks_v1" as const, extractionTransport, ...(model ? { allowPreviewModel: true, maxTransportAttempts: 1 as const } : {}) };
    try { await extractQuotation(parsed, extractionOptions); throw new Error("Offline preflight unexpectedly accepted an interpretation."); }
    catch (error) { if (!(error instanceof ProcessingError) || error.code !== "invalid_output") throw error; }
    if (requests.length !== planned.length || targetIds.size !== parsed.sources.length || parsed.sources.some(source => !targetIds.has(source.id))) throw new Error("The installed extraction implementation did not traverse every original source under the explicit retention policy.");
    documents.push({ id, sha256: fixture.sha256, parserComplete: parsed.manifest.complete, sourceCount: parsed.sources.length, plannedChunks: planned.length, capturedRequests: requests });
  }
  const captured = documents.flatMap(document => document.capturedRequests);
  const attempts = model ? 1 : 2;
  return { documents, reservation: { requests: captured.length, attemptSlots: captured.reduce((sum, request) => sum + request.attemptSlots, 0), estimatedTokens: captured.reduce((sum, request) => sum + request.reservedTokens, 0), nominalPacingMs: Math.max(0, captured.length - 1) * 60000, maxSingleAttemptEstimatedTokens: Math.max(...captured.map(request => request.reservedTokens / attempts)) } };
}

/** Injected invalid-response capture only: no credentials, SDK request or model output. */
export async function preflightDevelopment(name: string, root = process.cwd(), extractionTransport: DevelopmentOptions["extractionTransport"] = "legacy_v5", comparisonKind?: "model") {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use a fresh development experiment name.");
  assertDevelopmentEnvironment(process.env);
  if (!["legacy_v5", "typed_fields_v1", "typed_fields_v2", "fact_ledger_v1", "focused_fields_v1"].includes(extractionTransport)) throw new Error("Unknown extraction transport.");
  const policy = "retain_valid_chunks_v1" as const;
  if (comparisonKind === "model") {
    const manifest = await readDevelopmentManifest(root);
    const selection = PAIRED_COHORT.map(id => { const fixture = manifest.documents.find(document => document.id === id)!; return { id, format: fixture.format, sha256: fixture.sha256, goldSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex") }; });
    const models = [];
    const previousModel = process.env.GROQ_MODEL;
    try {
      for (const model of ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"] as const) {
        process.env.GROQ_MODEL = model;
        const configuration = await fingerprint(root, policy, extractionTransport, { model });
        const captured = await captureDevelopmentRequests(root, extractionTransport, model);
        models.push({ configuration, ...captured });
      }
    } finally { if (previousModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = previousModel; }
    const configurationStableDuringRun = (await Promise.all(models.map(async model => (await fingerprint(root, policy, extractionTransport, { model: model.configuration.model as NonNullable<DevelopmentOptions["model"]> })).sha256 === model.configuration.sha256))).every(Boolean);
    const fits = models.every(model => model.documents.every(document => document.parserComplete) && model.reservation.attemptSlots <= 12 && model.reservation.estimatedTokens <= 90000 && model.reservation.nominalPacingMs + 60000 <= 720000 && model.reservation.maxSingleAttemptEstimatedTokens <= 7500);
    const dailyBudget = await inspectModelStudyBudget(root);
    const report = { version: 2, modelStudyProtocolVersion: MODEL_STUDY_PROTOCOL_VERSION, name, measuredAt: new Date().toISOString(), mode: "offline_request_capture", comparisonKind, providerCalls: 0, modelOutputs: 0, heldoutReads: 0, selection, configurationStableDuringRun, models, limits: { attemptSlots: 12, estimatedTokens: 90000, totalWaitingMs: 720000, singleAttemptEstimatedTokens: 7500, sharedUtcDayEstimatedTokens: 180000, maxTransportAttempts: 1 }, fits, dailyBudget, limitation: "Full fixed cohort for each model, using invalid injected responses only. Estimated reservations include exactly one transport attempt; retry is disabled. A whole phase allocation must fit the shared UTC-day budget before any call. Known usage may exceed estimates; accounting uses the greater value without changing historical metadata. The next phase may require a new UTC day. This is not measured model quality, provider quota, or billing." };
    await writeImmutableJson(path.join(root, "eval/results/development", name, "offline-preflight.json"), report);
    console.log(JSON.stringify({ providerCalls: 0, models: models.map(model => ({ model: model.configuration.model, reservation: model.reservation })), fits, dailyBudget }));
    return report;
  }
  const configuration = await fingerprint(root, policy, extractionTransport);
  const { documents, reservation } = await captureDevelopmentRequests(root, extractionTransport);
  const fits = reservation.attemptSlots <= 24 && reservation.estimatedTokens <= 170000 && reservation.nominalPacingMs <= 600000 && reservation.maxSingleAttemptEstimatedTokens <= 7500;
  const report = { version: 1, name, measuredAt: new Date().toISOString(), mode: "offline_request_capture", providerCalls: 0, modelOutputs: 0, heldoutReads: 0, configuration, configurationStableDuringRun: (await fingerprint(root, policy, extractionTransport)).sha256 === configuration.sha256, documents, reservation, limits: { attemptSlots: 24, estimatedTokens: 170000, totalWaitingMs: 600000, singleAttemptEstimatedTokens: 7500 }, fits, limitation: "This captures actual application requests using explicitly labelled schema-invalid test responses for every chunk. They are not model results. It measures parser traversal and estimated reservations, not model schema acceptance, AI accuracy or available account quota. Unexpected provider quota or retries still consume the fixed live budget." };
  await writeImmutableJson(path.join(root, "eval/results/development", name, "offline-preflight.json"), report);
  console.log(JSON.stringify({ providerCalls: 0, plannedChunks: reservation.requests, reservation, fits }));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values = new Map<string, string>();
  try {
    for (let index = 0; index < args.length; index += 2) { if (!["--name", "--extraction-transport", "--comparison-kind"].includes(args[index]) || values.has(args[index]) || !args[index + 1]) throw new Error("Invalid offline preflight options."); values.set(args[index], args[index + 1]); }
    if (!values.get("--name") || (values.has("--comparison-kind") && values.get("--comparison-kind") !== "model")) throw new Error("Use --name <fresh-name> [--extraction-transport focused_fields_v1] [--comparison-kind model].");
    preflightDevelopment(values.get("--name")!, process.cwd(), values.get("--extraction-transport") as DevelopmentOptions["extractionTransport"], values.get("--comparison-kind") as "model" | undefined).catch(error => { console.error(error instanceof Error ? error.message : "Offline preflight failed."); process.exitCode = 1; });
  } catch (error) { console.error(error instanceof Error ? error.message : "Offline preflight failed."); process.exitCode = 1; }
}
