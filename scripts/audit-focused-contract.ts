import { createHash } from "node:crypto";
import { access, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod";
import { extractQuotation } from "../src/lib/ai";
import { compactExtractionRequest, type AIRequest, type AIResult } from "../src/lib/ai/groq";
import { focusedContractWireSchema } from "../src/lib/ai/focused-contract";
import { focusedExtractionWireSchema, expandFocusedExtraction, planFocusedExtraction, type FocusedDescriptor } from "../src/lib/ai/focused-transport";
import { sectionFieldKeys } from "../src/lib/ai/schema";
import { parseDocument, ProcessingError } from "../src/lib/processing";
import type { ParsedDocument, Quotation } from "../src/lib/domain/types";
import { assertDevelopmentEnvironment, PAIRED_COHORT, requestReservation, type DevelopmentEvent } from "../eval/development-control";
import { inspectModelStudyBudget } from "../eval/model-study-control";
import { scoreExtraction } from "../eval/metrics";
import { assertFocusedAuditReport } from "./audit-focused-development";
import { sanitizeSchemaIssues } from "./audit-development-rejections";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson, type evaluateDevelopment } from "./evaluate-development";
import type { FixtureRecord } from "./generate-fixtures";

type Report = Awaited<ReturnType<typeof evaluateDevelopment>>;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const itemKeys = new Set<string>(sectionFieldKeys.item);
const numericKeys = new Set(["quantity", "packageSize", "minimumOrder", "orderIncrement", "unitPrice", "lineAmount", "taxRate"]);
const namePattern = /^[a-z][a-z0-9-]{2,63}$/;
const hashPattern = /^[a-f0-9]{64}$/;
// This is a versioned contract audit, not an arbitrary changed-code replay.
const allowedChanges = new Set(["src/lib/ai/index.ts", "src/lib/ai/groq.ts", "src/lib/ai/focused-transport.ts", "src/lib/domain/validation.ts", "eval/development-control.ts", "scripts/evaluate-development.ts", "scripts/preflight-development.ts"]);

/** A v1 reply is not converted into a v2 reply. Only an unchanged saved scalar
 * is checked against its corresponding actual v2 field schema. */
export function diagnoseFocusedContractRecord(value: unknown, descriptor: FocusedDescriptor) {
  const saved = record(value), result = record(saved?.result);
  if (!result || !["invalid_output", "invalid_evidence"].includes(String(saved?.code))) throw new Error("A recorded interpretation rejection is required.");
  const disposition = result.finishReason === "provider_schema_rejected" ? "provider_schema_rejected" : result.rejectedAt === "transport" ? "transport_rejected" : "expanded_domain_rejected";
  const base = { originalDisposition: disposition, accepted: false, providerFailurePreserved: disposition === "provider_schema_rejected", candidateWireCompatibilityMeasured: false };
  if (result.rejectedAt !== "transport" || (result.finishReason !== "stop" && result.finishReason !== "provider_schema_rejected")) return { ...base, diagnostic: "raw_wire_unavailable", originalWireValid: null, scalarChecks: [], duplicateKnownFields: [], originalIssues: [] };
  let data: unknown = result.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return { ...base, diagnostic: "malformed_json", originalWireValid: false, scalarChecks: [], duplicateKnownFields: [], originalIssues: [] }; } }
  const known = [...descriptor.targetIds, ...descriptor.contextIds], slots = descriptor.slots.map(slot => slot.id);
  const original = focusedExtractionWireSchema(descriptor.kind, slots, known).safeParse(data);
  let originalAdapterValid = false;
  if (original.success) { try { expandFocusedExtraction(data, descriptor); originalAdapterValid = true; } catch (error) { if (!(error instanceof ProcessingError)) throw error; } }
  const candidate = focusedContractWireSchema("items", slots.length ? slots : ["auditSlot"], known) as unknown as { shape: { items: { shape: Record<string, { shape: Record<string, z.ZodType> }> } } };
  const schemas = candidate.shape.items.shape[slots[0] ?? "auditSlot"].shape;
  const scalarChecks: { field: string; valid: boolean; numeric: boolean }[] = [], duplicateKnownFields: string[] = [];
  const items = record(record(data)?.items);
  if (descriptor.kind === "items" && items) for (const slot of slots) {
    const item = record(items[slot]); if (!item) continue;
    const fields = Array.isArray(item.fields) ? item.fields : [], names = fields.map(field => record(field)?.key);
    duplicateKnownFields.push(...names.filter((key, index): key is string => typeof key === "string" && itemKeys.has(key) && names.indexOf(key) !== index));
    for (const input of fields) {
      const field = record(input); if (!field || typeof field.key !== "string" || !itemKeys.has(field.key)) continue;
      const { key, ...unchangedScalar } = field;
      scalarChecks.push({ field: key as string, numeric: numericKeys.has(key as string), valid: schemas[key as string].safeParse(unchangedScalar).success });
    }
  }
  return { ...base, diagnostic: "contract_fragments_only", originalWireValid: original.success, originalAdapterValid, scalarChecks, duplicateKnownFields,
    originalIssues: original.success ? [] : sanitizeSchemaIssues(original.error.issues) };
}

/** Uses existing annotations and identifier alignment, never the model's kind or
 * defaults as proof of absence. It does not add or alter a billing assertion. */
export function auditBillingAssertions(fixture: Pick<FixtureRecord, "fields">, quotation: Quotation | null, mappedItems: Record<string, string>) {
  const expected = fixture.fields.filter(field => /^items\.[^.]+\.billingBasis$/.test(field.path) && field.state === "value");
  let aligned = 0, stated = 0, correct = 0, sourceLinked = 0;
  for (const field of expected) {
    const item = quotation?.items.find(candidate => candidate.id === mappedItems[field.path.split(".")[1]]); if (!item) continue;
    aligned++;
    if (item.billingBasis.state === "value") { stated++; if (item.billingBasis.value === field.value) correct++; if (item.billingBasis.sourceIds.length) sourceLinked++; }
  }
  return { expectedStatedBillingAssertions: expected.length, alignedItems: aligned, statedAssertions: stated, correctAssertions: correct, assertionsWithReferences: sourceLinked,
    scope: "Historical finalized outputs only, with fixed annotated billing assertions. Missing output earns no credit; citations are not semantic entailment. No missing value is populated." };
}

export function assertContractAuditSource(value: unknown, name: string, phase: "before" | "after"): asserts value is Report {
  assertFocusedAuditReport(value, name, phase);
  if (value.configuration.extractionTransport !== "focused_fields_v1") throw new Error("The source must be a finalized original focused_fields_v1 model study.");
}
function descriptorFor(input: AIRequest): FocusedDescriptor {
  const body = JSON.parse(compactExtractionRequest(input).request.user) as { task: "items" | "document"; sources: { id: string; slot?: string; structuralHeader?: boolean }[]; context: { id: string }[] };
  const slots = new Map<string, string[]>();
  for (const source of body.sources) if (source.slot) slots.set(source.slot, [...(slots.get(source.slot) ?? []), source.id]);
  return { kind: body.task, targetIds: body.sources.map(source => source.id), contextIds: body.context.map(source => source.id), slots: [...slots].map(([id, sourceIds]) => ({ id, sourceIds })), structuralHeaderIds: body.sources.filter(source => source.structuralHeader).map(source => source.id) };
}
async function capture(parsed: ParsedDocument, transport: "focused_fields_v1" | "focused_fields_v2") {
  const requests: AIRequest[] = [];
  try {
    await extractQuotation(parsed, { extractionTransport: transport, chunkFailurePolicy: "retain_valid_chunks_v1", allowPreviewModel: true, request: async request => {
      requests.push(request); return { data: { injectedContractAuditInvalid: true }, model: "INJECTED-CONTRACT-AUDIT-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
    } });
    throw new Error("Contract request capture unexpectedly accepted an interpretation.");
  } catch (error) { if (!(error instanceof ProcessingError) || error.code !== "invalid_output") throw error; }
  if (requests.length !== planFocusedExtraction(parsed).length) throw new Error("The contract audit did not capture the entire focused plan.");
  return requests;
}

export async function auditFocusedContract(sourceName: string, candidateName: string, root = process.cwd()) {
  if (!namePattern.test(sourceName) || !namePattern.test(candidateName) || sourceName === candidateName) throw new Error("Use distinct safe source and candidate study names.");
  assertDevelopmentEnvironment(process.env);
  const outputPath = path.join(root, "eval/results/development", candidateName, "focused-contract-audit.json");
  try { await access(outputPath); throw new Error("An immutable contract audit already exists."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const hashes = new Map<string, string>();
  const read = async (file: string) => { if (await realpath(file) !== file) throw new Error("Contract audit inputs must not redirect."); const bytes = await readFile(file); hashes.set(file, sha(bytes)); return bytes; };
  const decode = <T>(bytes: Buffer): T => { try { return JSON.parse(bytes.toString("utf8")) as T; } catch { throw new Error("Malformed contract audit metadata."); } };
  const auditCodeSha256 = sha(await read(fileURLToPath(import.meta.url)));
  for (const helper of ["scripts/audit-focused-development.ts", "scripts/audit-development-rejections.ts"]) await read(path.join(root, helper));
  const reports = [];
  for (const phase of ["before", "after"] as const) {
    const file = path.join(root, "eval/results/development", sourceName, `live-${phase}.json`), bytes = await read(file), report = decode<Report>(bytes);
    assertContractAuditSource(report, sourceName, phase); reports.push({ phase, report, sha256: sha(bytes) });
  }
  if (JSON.stringify(reports[0].report.pair) !== JSON.stringify(reports[1].report.pair)) throw new Error("Original phase cohorts and policies differ.");
  const configuration = await fingerprint(root, "retain_valid_chunks_v1", "focused_fields_v2", { model: "openai/gpt-oss-120b" });
  const changedOriginalFiles = new Set<string>();
  for (const { report } of reports) {
    if (JSON.stringify(report.configuration.runtime) !== JSON.stringify(configuration.runtime)) throw new Error("The parser runtime or OCR asset differs from the original study.");
    for (const file of report.configuration.files) if (sha(await read(path.join(root, file.file))) !== file.sha256) {
      if (!allowedChanges.has(file.file)) throw new Error("An unrelated parser, scoring or dependency file changed."); changedOriginalFiles.add(file.file);
    }
  }
  await read(path.join(root, "eval/development/gold.json"));
  const manifest = await readDevelopmentManifest(root), fixtures = PAIRED_COHORT.map(id => manifest.documents.find(document => document.id === id)!);
  const parsed = new Map<string, ParsedDocument>(), requests = new Map<string, { legacy: AIRequest[]; candidate: AIRequest[] }>();
  for (const fixture of fixtures) {
    for (const { report } of reports) { const original = report.pair.selection.find(document => document.id === fixture.id); if (original?.sha256 !== fixture.sha256 || original.goldSha256 !== sha(JSON.stringify(fixture))) throw new Error("Source or annotations changed after the measured study."); }
    const bytes = await sourceFile(root, fixture), document = await parseDocument({ documentId: fixture.id, filename: path.basename(fixture.path), bytes }); parsed.set(fixture.id, document);
    const legacy = await capture(document, "focused_fields_v1"), candidate = await capture(document, "focused_fields_v2");
    const targets = (inputs: AIRequest[]) => inputs.map(input => { const body = JSON.parse(input.user); return { kind: body.task, sources: body.sources, context: body.context }; });
    if (JSON.stringify(targets(legacy)) !== JSON.stringify(targets(candidate))) throw new Error("Candidate planning changed; this bounded contract-only audit refuses it.");
    requests.set(fixture.id, { legacy, candidate });
  }
  const phases = [];
  for (const { phase, report, sha256 } of reports) {
    const directory = path.join(root, "eval/runs/private/development", sourceName, `live-${phase}`), plan = decode<{ configurationHash: string; pair: Report["pair"] }>(await read(path.join(directory, "plan.json")));
    if (plan.configurationHash !== report.configuration.sha256 || JSON.stringify(plan.pair) !== JSON.stringify(report.pair)) throw new Error("Private plan differs from the finalized phase.");
    const captured = new Map<string, { documentId: string; section: number; input: AIRequest }>();
    for (const [documentId, inputs] of requests) inputs.legacy.forEach((input, index) => {
      const key = sha(JSON.stringify({ version: report.configuration.promptVersion, model: report.configuration.model, request: input, ...(report.configuration.model === "qwen/qwen3.8-27b" ? { modelProfile: report.configuration.modelProfile!.version } : {}) }));
      captured.set(key, { documentId, section: index + 1, input });
    });
    const journal = (await read(path.join(directory, "usage.jsonl"))).toString("utf8").trim().split("\n").map(line => decode<DevelopmentEvent>(Buffer.from(line)));
    if (journal.some(event => event.requestKey && (!captured.has(event.requestKey) || event.documentId !== captured.get(event.requestKey)!.documentId))) throw new Error("Saved request identity differs from reconstructed v1 requests.");
    type Receipt = { kind: string; configurationHash: string; requestKey: string; model: string; documentId: string; result?: AIResult };
    const receipt = async (key: string, kind: "reservation" | "rejected" | "returned") => {
      const bound = captured.get(key), value = decode<Receipt>(await read(path.join(directory, "outcomes", `${key}.${kind}.json`)));
      if (!bound || value.kind !== kind || value.requestKey !== key || value.configurationHash !== report.configuration.sha256 || value.model !== report.configuration.model || value.documentId !== bound.documentId) throw new Error("A response receipt has inconsistent request identity.");
      return value;
    };
    const rejected = [], rejectionFiles = await readdir(path.join(directory, "rejected"));
    if (rejectionFiles.length > 24) throw new Error("The rejection set exceeds the bounded original study.");
    for (const filename of rejectionFiles) {
      const match = /^([a-f0-9]{64})-\d{13}-\d{1,9}\.json$/.exec(filename), bound = match ? captured.get(match[1]) : undefined;
      if (!match || !bound) throw new Error("An unscoped rejection filename was refused before reading its body.");
      await receipt(match[1], "reservation");
      const bytes = await read(path.join(directory, "rejected", filename));
      const value = decode<{ result: AIResult }>(bytes), rejectedReceipt = await receipt(match[1], "rejected");
      if (JSON.stringify(value.result) !== JSON.stringify(rejectedReceipt.result)) throw new Error("The rejected body differs from its immutable outcome receipt.");
      rejected.push({ documentId: bound.documentId, section: bound.section, requestSha256: match[1], artifactSha256: sha(bytes), ...diagnoseFocusedContractRecord(value, descriptorFor(bound.input)) });
    }
    const checkpointFiles = await readdir(path.join(directory, "requests"));
    if (checkpointFiles.length > 12) throw new Error("Accepted checkpoint count exceeds the original full phase.");
    for (const filename of checkpointFiles) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename) || !captured.has(filename.slice(0, 64))) throw new Error("An unscoped checkpoint was refused.");
      const result = decode<AIResult>(await read(path.join(directory, "requests", filename)));
      await receipt(filename.slice(0, 64), "reservation");
      const returned = await receipt(filename.slice(0, 64), "returned");
      if (JSON.stringify(result) !== JSON.stringify(returned.result)) throw new Error("The accepted checkpoint differs from its original returned receipt.");
      if (result.model !== report.configuration.model || result.rejectedAt || !Array.isArray(record(result.data)?.coverage)) throw new Error("An accepted expanded checkpoint has inconsistent metadata.");
    }
    const billing = [];
    for (const fixture of fixtures) {
      const measurement = report.measurements.find(document => document.id === fixture.id)!; let quotation: Quotation | null = null;
      if (measurement.retainedOutput) {
        const reference = measurement.retainedOutput;
        if (!new RegExp(`^outputs/${fixture.id}-[0-9]+\\.json$`).test(reference.path) || !hashPattern.test(reference.sha256)) throw new Error("Invalid finalized output binding.");
        const bytes = await read(path.join(directory, reference.path)); if (sha(bytes) !== reference.sha256) throw new Error("Finalized quotation hash changed.");
        quotation = decode<Quotation>(bytes);
        if (quotation.documentId !== fixture.id || quotation.contentHash !== fixture.sha256 || JSON.stringify(scoreExtraction(fixture, quotation, parsed.get(fixture.id)!)) !== JSON.stringify(measurement.score)) throw new Error("Historical quotation identity or score changed.");
      }
      billing.push({ documentId: fixture.id, outputAvailable: quotation !== null, ...auditBillingAssertions(fixture, quotation, measurement.score?.mappedItems ?? {}) });
    }
    phases.push({ phase, model: report.configuration.model, originalReportSha256: sha256, originalConfigurationHash: report.configuration.sha256, rejectedRecords: rejected.length, expandedAcceptedCheckpoints: checkpointFiles.length, acceptedCheckpointWireValidation: "unavailable_original_wire_not_saved", rejected, billing,
      originalCompletion: report.completion, historicalUsage: report.observedUsage });
  }
  const summarize = (inputs: AIRequest[]) => ({ requests: inputs.length, estimatedReservedTokens: inputs.reduce((sum, input) => sum + requestReservation(input, 1).reservedTokens, 0), maximumRequestEstimatedTokens: Math.max(...inputs.map(input => requestReservation(input, 1).reservedTokens)),
    schemaCharacters: inputs.reduce((sum, input) => sum + JSON.stringify(compactExtractionRequest(input).request.schema).length, 0), outputTokenCaps: inputs.map(input => input.maxOutputTokens) });
  const planning = { documents: fixtures.length, expectedItems: fixtures.reduce((sum, fixture) => sum + fixture.quotation.items.length, 0), sourceRecords: [...parsed.values()].reduce((sum, document) => sum + document.sources.length, 0), targetPartitionUnchanged: true,
    legacy: summarize([...requests.values()].flatMap(value => value.legacy)), candidate: summarize([...requests.values()].flatMap(value => value.candidate)) };
  const dailyBudget = await inspectModelStudyBudget(root);
  if ((await fingerprint(root, "retain_valid_chunks_v1", "focused_fields_v2", { model: "openai/gpt-oss-120b" })).sha256 !== configuration.sha256) throw new Error("Candidate configuration changed during audit.");
  for (const [file, expected] of hashes) if (sha(await read(file)) !== expected) throw new Error("An audit input changed during execution.");
  for (const fixture of fixtures) await sourceFile(root, fixture);
  const report = { version: 1, sourceName, candidateName, mode: "offline_contract_audit", measuredAt: new Date().toISOString(), providerCalls: 0, acceptedOutputs: 0, checkpointWrites: 0, heldoutReads: 0, auditCodeSha256, configuration, changedOriginalFiles: [...changedOriginalFiles].sort(), planning, dailyBudget, phases,
    inputArtifacts: [...hashes].map(([file, sha256]) => ({ path: path.relative(root, file).replaceAll("\\", "/"), sha256 })),
    limitations: ["This is a contract audit, not accuracy replay or fresh generation. Every historical rejection remains rejected, including parseable provider-rejected replies.", "Accepted checkpoints contain expanded data, so their original wire compliance with the candidate cannot be measured. No expanded object is reverse-engineered into a model reply.", "Unchanged known optional field fragments are checked against actual candidate schema nodes. A schema shape change does not prove the provider will generate a valid response or fill missing billing facts.", "Fixed named properties remove repeated entries in the old fields array; they do not prove a provider cannot emit duplicate JSON property names. Required state objects still permit truthful not_stated/ambiguous values.", "Billing diagnostics use original finalized outputs and fixed annotations, not model kind; the quota-aborted office checkpoint is not promoted to a quotation. No source or missing value is invented.", "Planning estimates are local heuristics, not token usage, billing or available provider quota. Original usage remains historical, with unknowns and full allocations retained.", "Sanitized schema diagnostics are bounded to100 issues per record. Raw values, messages, quotations and source identifiers are not published. No production settings or original artifacts are changed."] };
  await writeImmutableJson(outputPath, report);
  await writeFile(outputPath.replace(/\.json$/, ".md"), `# Offline focused field contract audit\n\nSource study: ${sourceName}. Candidate: ${candidateName}. No model calls, accepted outputs, checkpoint writes or held-out reads.\n\n${phases.reduce((sum, phase) => sum + phase.rejectedRecords, 0)} historical rejections remain rejected; ${phases.reduce((sum, phase) => sum + phase.expandedAcceptedCheckpoints, 0)} expanded accepted checkpoints have no saved original wire for candidate validation.\n\nThe unchanged plan covers ${planning.documents} complete originals, ${planning.expectedItems} expected items and ${planning.sourceRecords} source records. Estimated single-attempt reservations: v1 ${planning.legacy.estimatedReservedTokens}, candidate ${planning.candidate.estimatedReservedTokens}; neither is measured inference consumption.\n\n${report.limitations.map(value => `- ${value}`).join("\n")}\n\n[Sanitized audit](focused-contract-audit.json).\n`, { flag: "wx" });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--source-name" || args[2] !== "--candidate-name") { console.error("Use --source-name <finalized-v1-study> --candidate-name <new-candidate>."); process.exitCode = 1; }
  else auditFocusedContract(args[1], args[3]).then(() => console.log("Immutable contract audit written; zero provider calls or accepted outputs.")).catch(() => { console.error("Contract audit stopped: verify finalized scope, request identity and unchanged inputs. No private content was logged."); process.exitCode = 1; });
}
