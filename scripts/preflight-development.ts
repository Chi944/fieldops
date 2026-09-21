import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument, ProcessingError } from "../src/lib/processing";
import { extractQuotation, extractionChunks, type AIRequest, type AIResult } from "../src/lib/ai";
import { assertDevelopmentEnvironment, PAIRED_COHORT, requestReservation, type DevelopmentOptions } from "../eval/development-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson } from "./evaluate-development";

/** Injected invalid-response capture only: no credentials, SDK request or model output. */
export async function preflightDevelopment(name: string, root = process.cwd(), extractionTransport: DevelopmentOptions["extractionTransport"] = "legacy_v5") {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use a fresh development experiment name.");
  assertDevelopmentEnvironment(process.env);
  if (!["legacy_v5", "typed_fields_v1", "typed_fields_v2"].includes(extractionTransport)) throw new Error("Unknown extraction transport.");
  const policy = "retain_valid_chunks_v1" as const;
  const configuration = await fingerprint(root, policy, extractionTransport);
  const manifest = await readDevelopmentManifest(root);
  const documents = [];
  for (const id of PAIRED_COHORT) {
    const fixture = manifest.documents.find(document => document.id === id);
    if (!fixture) throw new Error("The fixed development cohort is incomplete.");
    const bytes = await sourceFile(root, fixture);
    const parsed = await parseDocument({ documentId: id, filename: path.basename(fixture.path), bytes });
    const planned = extractionChunks(parsed);
    const requests: { section: number; targetSourceCount: number; contextSourceCount: number; attemptSlots: number; reservedTokens: number }[] = [];
    const targetIds = new Set<string>();
    const request = async (input: AIRequest): Promise<AIResult> => {
      const body = JSON.parse(input.user) as { section: number; sources: { id: string }[]; context?: { id: string }[] };
      body.sources.forEach(source => { if (targetIds.has(source.id)) throw new Error("A target source occurs in multiple planned chunks."); targetIds.add(source.id); });
      requests.push({ section: body.section, targetSourceCount: body.sources.length, contextSourceCount: body.context?.length ?? 0, ...requestReservation(input) });
      // Exercise the real validation marker without inventing a supplier result.
      return { data: { injectedPreflightInvalid: true }, model: "INJECTED-PREFLIGHT-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
    };
    const extractionOptions = { request, chunkFailurePolicy: policy, extractionTransport };
    try { await extractQuotation(parsed, extractionOptions); throw new Error("Offline preflight unexpectedly accepted an interpretation."); }
    catch (error) { if (!(error instanceof ProcessingError) || error.code !== "invalid_output") throw error; }
    if (requests.length !== planned.length || targetIds.size !== parsed.sources.length) throw new Error("The installed extraction implementation did not traverse every source chunk under the explicit retention policy.");
    documents.push({ id, sha256: fixture.sha256, parserComplete: parsed.manifest.complete, sourceCount: parsed.sources.length, plannedChunks: planned.length, capturedRequests: requests });
  }
  const captured = documents.flatMap(document => document.capturedRequests);
  const reservation = { requests: captured.length, attemptSlots: captured.reduce((sum, request) => sum + request.attemptSlots, 0), estimatedTokens: captured.reduce((sum, request) => sum + request.reservedTokens, 0), nominalPacingMs: Math.max(0, captured.length - 1) * 60000, maxSingleAttemptEstimatedTokens: Math.max(...captured.map(request => request.reservedTokens / 2)) };
  const fits = reservation.attemptSlots <= 24 && reservation.estimatedTokens <= 170000 && reservation.nominalPacingMs <= 600000 && reservation.maxSingleAttemptEstimatedTokens <= 7500;
  const report = { version: 1, name, measuredAt: new Date().toISOString(), mode: "offline_request_capture", providerCalls: 0, modelOutputs: 0, heldoutReads: 0, configuration, configurationStableDuringRun: (await fingerprint(root, policy, extractionTransport)).sha256 === configuration.sha256, documents, reservation, limits: { attemptSlots: 24, estimatedTokens: 170000, totalWaitingMs: 600000, singleAttemptEstimatedTokens: 7500 }, fits, limitation: "This captures actual application requests using explicitly labelled schema-invalid test responses for every chunk. They are not model results. It measures parser traversal and estimated reservations, not model schema acceptance, AI accuracy or available account quota. Unexpected provider quota or retries still consume the fixed live budget." };
  await writeImmutableJson(path.join(root, "eval/results/development", name, "offline-preflight.json"), report);
  console.log(JSON.stringify({ providerCalls: 0, plannedChunks: captured.length, reservation, fits }));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== "--name" || (args.length === 4 && args[2] !== "--extraction-transport")) { console.error("Use --name <fresh-development-experiment> [--extraction-transport typed_fields_v1]."); process.exitCode = 1; }
  else preflightDevelopment(args[1], process.cwd(), args[3] as DevelopmentOptions["extractionTransport"]).catch(error => { console.error(error instanceof Error ? error.message : "Offline preflight failed."); process.exitCode = 1; });
}
