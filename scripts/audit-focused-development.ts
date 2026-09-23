import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planFocusedExtraction } from "../src/lib/ai/focused-transport";
import { parseDocument } from "../src/lib/processing";
import { calculateComparison } from "../src/lib/domain/calculate";
import type { Comparison, FieldValue, ParsedDocument, Quotation } from "../src/lib/domain/types";
import { scoreExtraction } from "../eval/metrics";
import { assertDevelopmentEnvironment, PAIRED_COHORT, summarizeDevelopmentUsage, type DevelopmentEvent, type DevelopmentOptions } from "../eval/development-control";
import { MODEL_STUDY_METRIC_VERSION } from "../eval/model-study-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson, type evaluateDevelopment } from "./evaluate-development";

type Report = Awaited<ReturnType<typeof evaluateDevelopment>>;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
function json<T>(bytes: Buffer): T { try { return JSON.parse(bytes.toString("utf8")) as T; } catch { throw new Error("An audit input contains malformed JSON; no input contents were published."); } }
async function readExact(filename: string): Promise<Buffer> {
  if (await realpath(filename) !== filename) throw new Error("Focused audit inputs must use their exact non-redirected paths.");
  return readFile(filename);
}
const sameSet = (actual: string[], expected: string[]) => actual.length === new Set(actual).size && actual.length === expected.length && actual.every(id => expected.includes(id));

export function parseFocusedAuditArguments(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--name", "--phase"].includes(args[index]) || values.has(args[index]) || !args[index + 1]) throw new Error("Use --name <finalized-study> --phase before|after.");
    values.set(args[index], args[index + 1]);
  }
  const name = values.get("--name"), phase = values.get("--phase");
  if (!name || !/^[a-z][a-z0-9-]{2,63}$/.test(name) || !["before", "after"].includes(phase ?? "")) throw new Error("Use --name <finalized-study> --phase before|after.");
  return { name, phase: phase as "before" | "after" };
}
export function assertFocusedAuditReport(value: unknown, name: string, phase: "before" | "after"): asserts value is Report {
  const report = value as Report;
  if (!report || report.name !== name || report.phase !== phase || report.mode !== "live" || !report.configurationStableDuringRun
    || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.measuredAt)) || Date.parse(report.measuredAt) < Date.parse(report.startedAt)
    || report.configuration?.comparisonKind !== "model" || !["focused_fields_v1", "focused_fields_v2"].includes(report.configuration?.extractionTransport) || report.configuration?.chunkFailurePolicy !== "retain_valid_chunks_v1" || report.configuration?.maxTransportAttempts !== 1
    || !["openai/gpt-oss-120b", "qwen/qwen3.8-27b"].includes(report.configuration?.model)
    || report.pair?.comparisonKind !== "model" || report.pair?.metricVersion !== MODEL_STUDY_METRIC_VERSION
    || JSON.stringify(report.pair?.selection?.map(document => document.id)) !== JSON.stringify(PAIRED_COHORT)
    || report.dataset?.split !== "dev" || report.dataset?.synthetic !== true || report.dataset?.requestedDocuments !== 3 || report.dataset?.heldoutDocumentsRead !== 0 || report.dataset?.heldoutModelCalls !== 0
    || JSON.stringify(report.measurements?.map(document => document.id)) !== JSON.stringify(PAIRED_COHORT)) throw new Error("Audit requires a finalized, stable, explicit focused model study on the fixed development cohort.");
  const { sha256, ...identity } = report.configuration;
  if (sha(JSON.stringify(identity)) !== sha256) throw new Error("The finalized configuration hash does not match its recorded identity.");
}

/** Pure, deterministic guard probe. No extraction is run and no quote is changed. */
export function auditFocusedQuotation(quotation: Quotation, parsed: ParsedDocument) {
  const tasks = planFocusedExtraction(parsed), sourceIds = new Set(parsed.sources.map(source => source.id));
  const failures = quotation.issues.flatMap(issue => {
    const match = /^Section (\d+) of (\d+) failed interpretation validation \((invalid_output|invalid_evidence)\)\./.exec(issue.message);
    if (!match) return [];
    const section = Number(match[1]), task = tasks[section - 1];
    return [{ section, kind: task?.kind ?? "unknown", targetCount: issue.sourceIds.length, sourceIds: issue.sourceIds,
      matchesPlannedTargets: Number(match[2]) === tasks.length && Boolean(task) && sameSet(issue.sourceIds, task.sources.map(source => source.id)),
      remainsBlocking: issue.code === "incomplete_extraction" && issue.severity === "error" && !issue.resolved }];
  });
  const failedIds = new Set(failures.flatMap(failure => failure.sourceIds));
  let inspectedFieldObjectsIncludingDefaults = 0, statedFields = 0, references = 0, resolvable = 0, statedFieldsWithoutReferences = 0;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("state" in value && "origin" in value && "sourceIds" in value && Array.isArray(value.sourceIds)) {
      const field = value as FieldValue;
      inspectedFieldObjectsIncludingDefaults++; references += field.sourceIds.length;
      resolvable += field.sourceIds.filter(id => sourceIds.has(id)).length;
      if (field.state === "value") { statedFields++; if (!field.sourceIds.length) statedFieldsWithoutReferences++; }
      return;
    }
    for (const [key, child] of Object.entries(value)) if (!["sources", "issues", "originalText"].includes(key)) visit(child);
  }
  visit(quotation);
  const blockers = quotation.issues.filter(issue => !issue.resolved && ["incomplete_extraction", "unverified_evidence"].includes(issue.code));
  const probe: Comparison = { id: "in-memory-focused-audit", workspaceId: "audit-only", name: "Audit", description: "", createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z", revision: 1, isDemo: false,
    quotations: [quotation], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" },
    groups: quotation.items.map((item, index) => ({ id: `audit-${index}`, label: "Audit item", members: [{ quotationId: quotation.id, itemId: item.id }], classification: "equivalent", status: "approved", explanation: "In-memory coverage guard probe", sourceIds: item.sourceIds, requiredQuantity: item.quantity.value ?? "1", requiredUnit: item.unit.value ?? "each", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: 1 })) };
  const calculation = calculateComparison(probe), values = calculation.groups.flatMap(group => group.values);
  const blockedValues = values.filter(value => value.status !== "eligible" && value.reasons.some(reason => reason.includes("outstanding coverage or evidence review"))).length;
  const costRecommendations = calculation.recommendations.filter(recommendation => recommendation.kind === "cost").length;
  const accepted = quotation.usage?.acceptedSections ?? (failures.length === 0 ? tasks.length : null);
  const rejected = quotation.usage?.rejectedSections ?? (failures.length === 0 ? 0 : null);
  return {
    plannedTasks: tasks.length, taskPlan: tasks.map((task, index) => ({ section: index + 1, kind: task.kind, targetCount: task.sources.length, contextCount: task.context.length, itemSlots: task.slots.length })),
    attemptedTasks: accepted !== null && rejected !== null ? accepted + rejected : null, validatedTasks: accepted, rejectedTasks: rejected,
    taskCountsAgree: accepted !== null && rejected !== null && accepted + rejected === tasks.length && rejected === failures.length && new Set(failures.map(failure => failure.section)).size === failures.length,
    failedTargets: { numerator: failedIds.size, denominator: parsed.sources.length, allResolvable: [...failedIds].every(id => sourceIds.has(id)), exactPlannedTaskSets: failures.every(failure => failure.matchesPlannedTargets), allRemainBlocking: failures.every(failure => failure.remainsBlocking), tasks: failures.map(({ sourceIds: _ids, ...failure }) => { void _ids; return failure; }) },
    originalSourceArrayPreserved: canonical(quotation.sources) === canonical(parsed.sources), originalSourceArraySha256: sha(canonical(parsed.sources)), retainedSourceArraySha256: sha(canonical(quotation.sources)),
    fieldReferences: { inspectedFieldObjectsIncludingDefaults, statedFields, references, resolvable, allResolvable: references === resolvable, statedFieldsWithoutReferences },
    costGuard: { unresolvedCoverageOrEvidenceIssues: blockers.length, retainedValuesChecked: values.length, explicitlyCoverageBlockedValues: blockedValues, costRecommendations,
      passes: blockers.length && values.length ? blockedValues === values.length && costRecommendations === 0 : failures.length ? false : null,
      scope: "Approved singleton groups probe only the deterministic coverage/evidence gate for retained rows. No matching or cross-supplier ranking accuracy is measured." },
  };
}

export async function auditFocusedDevelopment(name: string, phase: "before" | "after", root = process.cwd()) {
  parseFocusedAuditArguments(["--name", name, "--phase", phase]);
  assertDevelopmentEnvironment(process.env);
  const inputHashes = new Map<string, string>();
  const trackedRead = async (filename: string) => { const bytes = await readExact(filename); inputHashes.set(filename, sha(bytes)); return bytes; };
  const auditCodeSha256 = sha(await trackedRead(fileURLToPath(import.meta.url)));
  const directory = path.join(root, "eval/results/development", name), reportPath = path.join(directory, `live-${phase}.json`);
  let reportBytes: Buffer;
  try { reportBytes = await trackedRead(reportPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("The selected phase has no finalized report. This audit stops without polling or inspecting private outputs."); throw error; }
  const report = json<Report>(reportBytes); assertFocusedAuditReport(report, name, phase);
  const model = report.configuration.model as NonNullable<DevelopmentOptions["model"]>;
  const current = () => fingerprint(root, "retain_valid_chunks_v1", report.configuration.extractionTransport, { model });
  if ((await current()).sha256 !== report.configuration.sha256) throw new Error("The current source/runtime differs from the measured focused phase; use its recorded revision.");
  await trackedRead(path.join(root, "eval/development/gold.json"));
  const manifest = await readDevelopmentManifest(root), privateDirectory = path.join(root, "eval/runs/private/development", name, `live-${phase}`);
  const plan = json<{ configurationHash: string; pair: Report["pair"] }>(await trackedRead(path.join(privateDirectory, "plan.json")));
  if (plan.configurationHash !== report.configuration.sha256 || canonical(plan.pair) !== canonical(report.pair)) throw new Error("The private phase plan does not match the finalized report.");
  const journalBytes = await trackedRead(path.join(privateDirectory, "usage.jsonl"));
  const events = journalBytes.toString("utf8").split("\n").filter(Boolean).map(line => json<DevelopmentEvent>(Buffer.from(line)));
  if (events.some(event => !PAIRED_COHORT.includes(event.documentId ?? "") || !Number.isFinite(Date.parse(event.at)))) throw new Error("The selected phase journal contains out-of-scope metadata.");
  const journalUsage = summarizeDevelopmentUsage(events);
  for (const key of ["dispatches", "reservedAttemptSlots", "reservedTokens", "returnedResponses", "responsesWithoutUsage", "inputTokens", "outputTokens"] as const) if (journalUsage[key] !== report.observedUsage[key]) throw new Error("The selected journal no longer matches the finalized usage counts.");
  const outputDirectory = path.join(privateDirectory, "outputs");
  let outputFiles: string[] = [];
  try { if (await realpath(outputDirectory) !== outputDirectory) throw new Error("Private outputs must not redirect."); outputFiles = await readdir(outputDirectory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const documents = [];
  for (const id of PAIRED_COHORT) {
    const fixture = manifest.documents.find(document => document.id === id)!;
    const selected = report.pair.selection.find(document => document.id === id);
    if (!selected || selected.sha256 !== fixture.sha256 || selected.goldSha256 !== sha(JSON.stringify(fixture))) throw new Error("The development source or gold identity differs from the finalized cohort.");
    const original = await sourceFile(root, fixture); inputHashes.set(path.join(root, fixture.path), sha(original));
    const parsed = await parseDocument({ documentId: id, filename: path.basename(fixture.path), bytes: original });
    const measurement = report.measurements.find(document => document.id === id)!;
    const journal = events.filter(event => event.documentId === id);
    const freshJournal = { dispatchReservations: journal.filter(event => event.kind === "reservation").length, returnedResponses: journal.filter(event => event.kind === "response").length, responsesWithoutUsage: journal.filter(event => event.kind === "response" && event.usageAvailable !== true).length, rejectionEvents: journal.filter(event => event.kind === "rejection" && !event.cached).length, cachedRejectionEvents: journal.filter(event => event.kind === "rejection" && event.cached).length };
    const candidates = outputFiles.filter(file => file.startsWith(`${id}-`) && /^\d+\.json$/.test(file.slice(id.length + 1))).filter(file => { const at = Number(file.slice(id.length + 1, -5)); return at >= Date.parse(report.startedAt) && at <= Date.parse(report.measuredAt); });
    if (!["partial", "complete"].includes(measurement.status)) {
      if (candidates.length) throw new Error("An unavailable output status conflicts with a private quotation in the recorded phase interval.");
      documents.push({ id, status: measurement.status, retainedOutputAvailable: false, freshJournal, plannedTasks: planFocusedExtraction(parsed).length, sourceTargets: parsed.sources.length, attemptedTasks: measurement.status === "not_attempted" ? 0 : null, validatedTasks: null, rejectedTasks: null, failedTargets: null,
        limitation: "No returned quotation; exact failed-task attribution and retained-value checks are unavailable. Fresh dispatch/response counts are not silently treated as unique tasks." });
      continue;
    }
    if (candidates.length !== 1) throw new Error("Exactly one retained output must match the finalized phase interval; ambiguous output selection is refused.");
    if (measurement.retainedOutput && measurement.retainedOutput.path !== `outputs/${candidates[0]}`) throw new Error("The finalized output binding does not match the retained quotation.");
    const bytes = await trackedRead(path.join(outputDirectory, candidates[0])), quotation = json<Quotation>(bytes);
    if (measurement.retainedOutput && sha(bytes) !== measurement.retainedOutput.sha256) throw new Error("The finalized retained output hash changed.");
    if (quotation.documentId !== id || quotation.contentHash !== fixture.sha256 || (measurement.status === "complete") !== (quotation.status === "ready" && quotation.manifest.complete) || canonical(scoreExtraction(fixture, quotation, parsed)) !== canonical(measurement.score)) throw new Error("The retained quotation does not match its recorded identity, status or score.");
    documents.push({ id, status: measurement.status, retainedOutputAvailable: true, retainedOutputSha256: sha(bytes), freshJournal, ...auditFocusedQuotation(quotation, parsed) });
  }
  if ((await current()).sha256 !== report.configuration.sha256) throw new Error("Measured source/runtime changed during audit.");
  for (const [filename, expected] of inputHashes) if (sha(await readExact(filename)) !== expected) throw new Error("An audit input or the audit code changed during execution.");
  const audit = { version: 1, name, phase, auditedAt: new Date().toISOString(), mode: "offline_focused_task_audit", reportSha256: sha(reportBytes), journalSha256: sha(journalBytes), auditCodeSha256, configurationHash: report.configuration.sha256, providerCalls: 0, heldoutReads: 0, documents,
    limitations: ["Task validation and partial availability are not semantic extraction correctness. Resolvable field references do not prove that cited text supports a claim.", "Failed-target counts use the focused planner, excluding repeated read-only context. No legacy character-chunk assumptions are used.", "Returned task counts are checked against metadata and exact static failed-task issue sets. Fresh journal counts are separate and may include cached reuse or operational failures.", "No output means exact task attribution is unavailable. This audit does not decode, repair, replay or accept rejected replies.", "The cost probe uses approved singleton groups solely to test unresolved coverage/evidence blocking; it is not a comparative recommendation or matching-quality benchmark.", "Only sanitized counts and hashes are published. Source arrays, supplier values, source identifiers and model replies remain private."] };
  const basename = `focused-task-audit-${phase}`;
  await writeImmutableJson(path.join(directory, `${basename}.json`), audit);
  const rows = documents.map(document => `| ${document.id} | ${document.status} | ${document.plannedTasks} | ${document.validatedTasks ?? "unavailable"} | ${document.rejectedTasks ?? "unavailable"} | ${document.failedTargets ? `${document.failedTargets.numerator}/${document.failedTargets.denominator}` : "unavailable"} |`).join("\n");
  await writeFile(path.join(directory, `${basename}.md`), `# Focused task audit: ${phase}\n\nReport SHA-256: \`${audit.reportSha256}\`. Audit code SHA-256: \`${auditCodeSha256}\`. Zero provider calls and held-out reads.\n\n| Document | Result | Planned tasks | Validated | Rejected | Failed targets / all targets |\n|---|---|---:|---:|---:|---:|\n${rows}\n\n${audit.limitations.map(limitation => `- ${limitation}`).join("\n")}\n\n[Sanitized audit JSON](${basename}.json). Original phase reports and private checkpoints were read only.\n`, { flag: "wx" });
  return audit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const options = parseFocusedAuditArguments(process.argv.slice(2)); auditFocusedDevelopment(options.name, options.phase).then(() => console.log("Sanitized focused task audit written.")).catch(error => { console.error(error instanceof Error ? error.message : "Focused audit failed."); process.exitCode = 1; }); }
  catch (error) { console.error(error instanceof Error ? error.message : "Focused audit failed."); process.exitCode = 1; }
}
