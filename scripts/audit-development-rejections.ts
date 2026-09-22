import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { partitionedExtractionWireSchemaForTargets } from "../src/lib/ai/partitioned-transport";
import { extractQuotation, extractionChunks } from "../src/lib/ai";
import { AIInterpretationError, compactExtractionRequest, PROMPT_VERSION, type AIRequest } from "../src/lib/ai/groq";
import { parseDocument, ProcessingError } from "../src/lib/processing";
import { assertDevelopmentEnvironment, PAIRED_COHORT } from "../eval/development-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson, type evaluateDevelopment } from "./evaluate-development";

type Report = Awaited<ReturnType<typeof evaluateDevelopment>>;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const staticNames = new Set(["supplier", "quotation", "terms", "items", "charges", "attributes", "excluded", "uncertainties", "numeric", "text", "decimal", "fields", "sourceIds", "sourceId", "itemSourceId", "kind", "taxBasis", "tiers", "discounts", "discount", "type", "unit", "label", "key", "value", "raw", "state", "billingPeriod", "appliesTo", "disposition", "reason", "message", "min", "max", "unitPrice", "basis", "alreadyIncluded", "coverage", "description", "identifier", "quantity", "lineAmount"]);
const issueCodes = new Set(["invalid_type", "too_big", "too_small", "invalid_format", "not_multiple_of", "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element", "invalid_value", "custom"]);
const processingCodes = new Set(["invalid_output", "invalid_evidence", "model_error", "limit_exceeded", "timeout", "quota", "cancelled", "ai_unavailable"]);
export interface SafeSchemaIssue { code: string; path: string; unknownKeys?: string[]; }
interface RejectionAuditEntry { documentId: string; section: number; requestSha256: string; rejectionSha256: string; stage: string; outcome: string; issues: SafeSchemaIssue[]; recordedErrorCode?: string; cached?: boolean; usageAvailable?: boolean; }
function safePath(value: unknown): string {
  if (!Array.isArray(value)) return "[unavailable]";
  return value.length ? "/" + value.slice(0, 24).map(part => typeof part === "string" && staticNames.has(part) ? part : Number.isSafeInteger(part) && Number(part) >= 0 && Number(part) <= 999 ? String(part) : "[redacted]").join("/") : "";
}
/** Deliberately omit Zod messages, input values, expected/received enum values,
 * arbitrary key names and source aliases. Even diagnostic paths are allowlisted.
 */
export function sanitizeSchemaIssues(issues: unknown[]): SafeSchemaIssue[] {
  const safe: SafeSchemaIssue[] = [];
  function visit(values: unknown[], depth: number): void {
    if (depth > 4) return;
    for (const value of values) {
      if (safe.length >= 100) return;
      const issue = record(value); if (!issue) continue;
      safe.push({ code: typeof issue.code === "string" && issueCodes.has(issue.code) ? issue.code : "unclassified", path: safePath(issue.path), ...(issue.code === "unrecognized_keys" && Array.isArray(issue.keys) ? { unknownKeys: issue.keys.slice(0, 30).map(key => typeof key === "string" && staticNames.has(key) ? key : "[redacted]") } : {}) });
      if (Array.isArray(issue.errors)) for (const branch of issue.errors) if (Array.isArray(branch)) visit(branch, depth + 1);
    }
  }
  visit(issues, 0); return safe;
}

/** Offline inspection only. Passing wire validation never accepts a response,
 * repairs it, replays domain integration or writes a successful checkpoint.
 */
export function diagnoseRejectedRecord(value: unknown, targetAliases: string[], knownAliases: string[]) {
  const rejection = record(value), result = record(rejection?.result);
  const code = typeof rejection?.code === "string" && processingCodes.has(rejection.code) ? rejection.code : "unclassified";
  const metadata = { recordedErrorCode: code, cached: rejection?.cached === true, usageAvailable: result?.usageAvailable === true };
  if (!result) return { ...metadata, stage: "unavailable", outcome: "invalid_rejection_record", issues: [] as SafeSchemaIssue[] };
  const stage = result.finishReason === "provider_schema_rejected" ? "provider_schema_rejected" : result.rejectedAt === "transport" ? "transport" : "domain";
  // Domain-stage results have already been expanded into the core schema. A wire
  // error inferred from that different representation would be misleading.
  if (stage === "domain") return { ...metadata, stage, outcome: "stage_cause_unavailable", issues: [] as SafeSchemaIssue[] };
  let data: unknown = result.data;
  if (typeof data === "string") {
    if (data.length > 1024 * 1024) return { ...metadata, stage, outcome: "raw_payload_over_audit_limit", issues: [] as SafeSchemaIssue[] };
    try { data = JSON.parse(data); } catch { return { ...metadata, stage, outcome: "malformed_json", issues: [] as SafeSchemaIssue[] }; }
  }
  const checked = partitionedExtractionWireSchemaForTargets(targetAliases, knownAliases).safeParse(data);
  return { ...metadata, stage, outcome: checked.success ? "wire_schema_valid_cause_unavailable" : "wire_schema_invalid", issues: checked.success ? [] : sanitizeSchemaIssues(checked.error.issues) };
}

export function assertRejectionAuditReport(value: unknown, name: string): asserts value is Report {
  const report = record(value), configuration = record(report?.configuration), dataset = record(report?.dataset), pair = record(report?.pair);
  const selection = Array.isArray(pair?.selection) ? pair.selection : [];
  if (report?.name !== name || report.phase !== "after" || report.mode !== "live" || report.configurationStableDuringRun !== true || configuration?.extractionTransport !== "typed_fields_v2" || configuration.chunkFailurePolicy !== "retain_valid_chunks_v1" || dataset?.split !== "dev" || dataset.requestedDocuments !== PAIRED_COHORT.length || dataset.heldoutDocumentsRead !== 0 || dataset.heldoutModelCalls !== 0 || JSON.stringify(selection.map(document => record(document)?.id)) !== JSON.stringify(PAIRED_COHORT)) throw new Error("A finalized, stable typed-fields-v2 retention report for the fixed development cohort is required.");
}
async function readExact(filename: string, maximumBytes = 2 * 1024 * 1024): Promise<Buffer> {
  if (await realpath(filename) !== filename) throw new Error("Audit inputs must not redirect outside their fixed paths.");
  const bytes = await readFile(filename);
  if (bytes.length > maximumBytes) throw new Error("An audit input exceeds the bounded local inspection limit.");
  return bytes;
}
export async function auditDevelopmentRejections(name: string, root = process.cwd()) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use a finalized development experiment name.");
  assertDevelopmentEnvironment(process.env);
  const directory = path.join(root, "eval/results/development", name), reportPath = path.join(directory, "live-after.json");
  let reportBytes: Buffer;
  try { reportBytes = await readExact(reportPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("The after report is not finalized. This audit stops without polling."); throw error; }
  let report: unknown; try { report = JSON.parse(reportBytes.toString("utf8")); } catch { throw new Error("The finalized report is not valid JSON."); }
  assertRejectionAuditReport(report, name);
  if ((await fingerprint(root, "retain_valid_chunks_v1", "typed_fields_v2")).sha256 !== report.configuration.sha256) throw new Error("Current source/runtime differs from the finalized report. Restore the recorded configuration before this audit.");
  const manifest = await readDevelopmentManifest(root);
  const captured = new Map<string, { documentId: string; section: number; targetAliases: string[]; knownAliases: string[] }>();
  for (const id of PAIRED_COHORT) {
    const fixture = manifest.documents.find(document => document.id === id)!, selection = report.pair.selection.find(document => document.id === id);
    if (!fixture || selection?.sha256 !== fixture.sha256 || selection.goldSha256 !== sha(JSON.stringify(fixture))) throw new Error("Development source/gold identity differs from the finalized report.");
    const parsed = await parseDocument({ documentId: id, filename: path.basename(fixture.path), bytes: await sourceFile(root, fixture) });
    let count = 0;
    const request = async (original: AIRequest): Promise<never> => {
      if (original.transport !== "quotation-v7") throw new Error("The captured request is not the recorded partitioned transport.");
      const key = sha(JSON.stringify({ version: PROMPT_VERSION, model: report.configuration.model, request: original }));
      const wire = compactExtractionRequest(original).request;
      const body = JSON.parse(wire.user) as { section: number; sources: { id: string }[]; context?: { id: string }[] };
      if (captured.has(key)) throw new Error("Captured requests are not uniquely attributable.");
      captured.set(key, { documentId: id, section: body.section, targetAliases: body.sources.map(source => source.id), knownAliases: [...body.sources, ...(body.context ?? [])].map(source => source.id) }); count++;
      // A labelled injected failure traverses the real request construction. No
      // successful fake output, provider request or checkpoint is created.
      throw new AIInterpretationError(new ProcessingError("invalid_output", "Injected audit request capture; no provider call."), { data: null, model: "INJECTED-AUDIT-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false }, false);
    };
    try { await extractQuotation(parsed, { request, extractionTransport: "typed_fields_v2", chunkFailurePolicy: "retain_valid_chunks_v1" }); throw new Error("Audit capture unexpectedly returned an interpretation."); }
    catch (error) { if (!(error instanceof ProcessingError) || error.code !== "invalid_output") throw error; }
    if (count !== extractionChunks(parsed).length) throw new Error("Audit capture did not traverse every planned request.");
  }
  const privateDirectory = path.join(root, "eval/runs/private/development", name, "live-after", "rejected");
  let filenames: string[];
  try { filenames = await readdir(privateDirectory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; filenames = []; }
  if (filenames.length > 100) throw new Error("The private rejection set exceeds this fixed-cohort audit's limit.");
  const rejections: RejectionAuditEntry[] = [];
  for (const filename of filenames.sort()) {
    const match = /^([a-f0-9]{64})-\d{13}-\d{1,9}\.json$/.exec(filename);
    const request = match ? captured.get(match[1]) : undefined;
    if (!match || !request) throw new Error("A rejection file cannot be matched to a reconstructed request. No unscoped file was read.");
    const bytes = await readExact(path.join(privateDirectory, filename));
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { rejections.push({ documentId: request.documentId, section: request.section, requestSha256: match[1], rejectionSha256: sha(bytes), stage: "unavailable", outcome: "record_malformed_json", issues: [] as SafeSchemaIssue[] }); continue; }
    rejections.push({ documentId: request.documentId, section: request.section, requestSha256: match[1], rejectionSha256: sha(bytes), ...diagnoseRejectedRecord(value, request.targetAliases, request.knownAliases) });
  }
  if ((await fingerprint(root, "retain_valid_chunks_v1", "typed_fields_v2")).sha256 !== report.configuration.sha256) throw new Error("Configuration changed during the offline audit; no result was written.");
  const counts = (key: "stage" | "outcome") => Object.fromEntries([...new Set(rejections.map(rejection => rejection[key]))].sort().map(value => [value, rejections.filter(rejection => rejection[key] === value).length]));
  const audit = { version: 1, name, auditedAt: new Date().toISOString(), reportSha256: sha(reportBytes), auditCodeSha256: sha(await readFile(fileURLToPath(import.meta.url))), configurationHash: report.configuration.sha256, providerCalls: 0, acceptedOutputs: 0, checkpointWrites: 0, heldoutReads: 0, capturedRequests: captured.size, rejectedRecords: rejections.length, providerRequestSchemaRejectedDocuments: report.measurements.filter(document => document.schemaDiagnostic).length, countsByStage: counts("stage"), countsByOutcome: counts("outcome"), rejections,
    limitations: ["Saved raw bodies are checked against the reconstructed partitioned wire schema; this does not accept, repair or replay an extraction.", "A locally wire-valid response can still fail state, normalization, source-evidence or business validation; its specific cause is unavailable here.", "Domain-stage records are already expanded and are not misvalidated as raw wire responses. Their recorded error category is retained; detailed cause is unavailable.", "Provider schema rejection means the provider rejected generated output; request-schema rejection documents are counted separately from the finalized report.", "Issue messages, received values, source aliases, citations and arbitrary unknown-key names are never published. Known structural names and bounded indices are allowed.", "Diagnostics are limited to 100 issues per record, four nested union levels, 24 path components and 30 unknown-key names per issue; they are not exhaustive.", "Records include cached rejections if present and need not equal fresh provider attempts. This audit does not remeasure usage or extraction accuracy."] };
  await writeImmutableJson(path.join(directory, "rejection-audit.json"), audit);
  await writeFile(path.join(directory, "rejection-audit.md"), `# Offline rejection audit\n\nReport SHA-256: \`${audit.reportSha256}\`. Audit code SHA-256: \`${audit.auditCodeSha256}\`. No model calls, accepted outputs, checkpoint writes or held-out reads.\n\n${audit.rejectedRecords} saved rejection records matched ${audit.capturedRequests} reconstructed requests.\n\n| Outcome | Records |\n|---|---:|\n${Object.entries(audit.countsByOutcome).map(([outcome, count]) => `| ${outcome} | ${count} |`).join("\n")}\n\n${audit.limitations.map(limitation => `- ${limitation}`).join("\n")}\n\n[Sanitized diagnostic JSON](rejection-audit.json).\n`, { flag: "wx" });
  return audit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--name") { console.error("Use --name <finalized-development-experiment>."); process.exitCode = 1; }
  else auditDevelopmentRejections(args[1]).then(() => console.log("Immutable sanitized rejection audit written.")).catch(() => { console.error("Offline rejection audit stopped. Check finalization, configuration and scoped input integrity; raw diagnostic content was not logged."); process.exitCode = 1; });
}
