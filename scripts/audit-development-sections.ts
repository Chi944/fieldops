import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractionChunks } from "../src/lib/ai";
import { parseDocument } from "../src/lib/processing";
import { calculateComparison } from "../src/lib/domain/calculate";
import type { Comparison, FieldValue, ParsedDocument, Quotation } from "../src/lib/domain/types";
import { scoreExtraction } from "../eval/metrics";
import { assertDevelopmentEnvironment, PAIRED_COHORT, type DevelopmentEvent } from "../eval/development-control";
import { fingerprint, readDevelopmentManifest, sourceFile, writeImmutableJson, type evaluateDevelopment } from "./evaluate-development";

type Report = Awaited<ReturnType<typeof evaluateDevelopment>>;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
const sameSet = (actual: string[], expected: string[]) => actual.length === new Set(actual).size && actual.length === expected.length && actual.every(id => expected.includes(id));
async function readExact(filename: string): Promise<Buffer> {
  if (await realpath(filename) !== filename) throw new Error("Audit inputs must not redirect outside their fixed paths.");
  return readFile(filename);
}
export function auditRetainedQuotation(quotation: Quotation, parsed: ParsedDocument) {
  const planned = extractionChunks(parsed), sourceIds = new Set(parsed.sources.map(source => source.id));
  const failures = quotation.issues.flatMap(issue => {
    const match = /^Section (\d+) of (\d+) failed interpretation validation \((invalid_output|invalid_evidence)\)\./.exec(issue.message);
    if (!match) return [];
    const section = Number(match[1]);
    return [{ section, targetCount: issue.sourceIds.length, sourceIds: issue.sourceIds, matchesPlannedTargets: Number(match[2]) === planned.length && Boolean(planned[section - 1]) && sameSet(issue.sourceIds, planned[section - 1].map(source => source.id)), remainsBlocking: issue.code === "incomplete_extraction" && issue.severity === "error" && !issue.resolved }];
  });
  const failedIds = new Set(failures.flatMap(failure => failure.sourceIds));
  let inspectedFieldObjectsIncludingDefaults = 0, statedFields = 0, references = 0, resolved = 0, statedWithoutReferences = 0;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("state" in value && "origin" in value && "sourceIds" in value && Array.isArray(value.sourceIds)) {
      const field = value as FieldValue;
      inspectedFieldObjectsIncludingDefaults++; references += field.sourceIds.length;
      if (field.state === "value") statedFields++;
      resolved += field.sourceIds.filter(id => sourceIds.has(id)).length;
      if (field.state === "value" && !field.sourceIds.length) statedWithoutReferences++;
      return;
    }
    for (const [key, child] of Object.entries(value)) if (!["sources", "issues", "originalText"].includes(key)) visit(child);
  }
  visit(quotation);
  const blockers = quotation.issues.filter(issue => !issue.resolved && ["incomplete_extraction", "unverified_evidence"].includes(issue.code));
  const probe: Comparison = { id: "in-memory-section-audit", workspaceId: "audit-only", name: "Audit", description: "", createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z", revision: 1, isDemo: false, quotations: [quotation], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" }, groups: quotation.items.map((item, index) => ({ id: `audit-${index}`, label: "Audit item", members: [{ quotationId: quotation.id, itemId: item.id }], classification: "equivalent", status: "approved", explanation: "In-memory guard probe only", sourceIds: item.sourceIds, requiredQuantity: item.quantity.value ?? "1", requiredUnit: item.unit.value ?? "each", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: 1 })) };
  const calculation = calculateComparison(probe), values = calculation.groups.flatMap(group => group.values);
  const coverageBlockedValues = values.filter(value => value.status !== "eligible" && value.reasons.some(reason => reason.includes("outstanding coverage or evidence review"))).length;
  const acceptedSections = quotation.usage?.acceptedSections ?? planned.length - failures.length;
  const rejectedSections = quotation.usage?.rejectedSections ?? failures.length;
  return {
    plannedSections: planned.length, attemptedSections: planned.length, validatedSections: acceptedSections, rejectedSections,
    sectionCountsAgree: acceptedSections + rejectedSections === planned.length && rejectedSections === failures.length && new Set(failures.map(failure => failure.section)).size === failures.length,
    failedTargets: { numerator: failedIds.size, denominator: parsed.sources.length, allResolvable: [...failedIds].every(id => sourceIds.has(id)), exactPlannedSectionSets: failures.every(failure => failure.matchesPlannedTargets), allRemainBlocking: failures.every(failure => failure.remainsBlocking), sections: failures.map(failure => ({ section: failure.section, targetCount: failure.targetCount, matchesPlannedTargets: failure.matchesPlannedTargets, remainsBlocking: failure.remainsBlocking })) },
    originalSourceArrayPreserved: canonical(quotation.sources) === canonical(parsed.sources), originalSourceArraySha256: sha(canonical(parsed.sources)), retainedSourceArraySha256: sha(canonical(quotation.sources)),
    fieldReferences: { inspectedFieldObjectsIncludingDefaults, statedFields, references, resolvable: resolved, allResolvable: references === resolved, statedFieldsWithoutReferences: statedWithoutReferences },
    costGuard: { unresolvedCoverageOrEvidenceIssues: blockers.length, retainedValuesChecked: values.length, explicitlyCoverageBlockedValues: coverageBlockedValues, costRecommendations: calculation.recommendations.filter(recommendation => recommendation.kind === "cost").length, passes: blockers.length && values.length ? coverageBlockedValues === values.length && calculation.recommendations.every(recommendation => recommendation.kind !== "cost") : null, scope: "In-memory approved singleton groups isolate the existing coverage/evidence gate on each retained row. This is not a cross-supplier ranking or matching-quality test." },
  };
}

export async function auditDevelopmentSections(name: string, root = process.cwd()) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use a finalized development experiment name.");
  assertDevelopmentEnvironment(process.env);
  const directory = path.join(root, "eval/results/development", name), reportPath = path.join(directory, "live-after.json");
  let reportBytes: Buffer;
  try { reportBytes = await readExact(reportPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("The after report is not finalized. Stop here and run the audit only after completion; this command does not poll."); throw error; }
  const report = JSON.parse(reportBytes.toString("utf8")) as Report;
  if (report.name !== name || report.phase !== "after" || report.mode !== "live" || !report.configurationStableDuringRun || report.configuration.chunkFailurePolicy !== "retain_valid_chunks_v1" || JSON.stringify(report.pair.selection.map(document => document.id)) !== JSON.stringify(PAIRED_COHORT) || report.dataset.split !== "dev" || report.dataset.heldoutDocumentsRead || report.dataset.heldoutModelCalls) throw new Error("This audit requires the finalized fixed-cohort development retention run.");
  if ((await fingerprint(root, "retain_valid_chunks_v1")).sha256 !== report.configuration.sha256) throw new Error("Current source/runtime differs from the finalized report; reconstruct the recorded revision before auditing its section plan.");
  const manifest = await readDevelopmentManifest(root), privateDirectory = path.join(root, "eval/runs/private/development", name, "live-after");
  const journalBytes = await readExact(path.join(privateDirectory, "usage.jsonl"));
  const events = journalBytes.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as DevelopmentEvent);
  let outputFiles: string[] = [];
  try { outputFiles = await readdir(path.join(privateDirectory, "outputs")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const documents = [];
  for (const id of PAIRED_COHORT) {
    const fixture = manifest.documents.find(document => document.id === id)!;
    if (report.pair.selection.find(document => document.id === id)?.sha256 !== fixture.sha256) throw new Error("The original source hash differs from the recorded cohort.");
    const parsed = await parseDocument({ documentId: id, filename: path.basename(fixture.path), bytes: await sourceFile(root, fixture) });
    const measurement = report.measurements.find(document => document.id === id)!;
    const journal = events.filter(event => event.documentId === id);
    const fresh = { dispatchReservations: journal.filter(event => event.kind === "reservation").length, returnedResponses: journal.filter(event => event.kind === "response").length, responsesWithoutUsage: journal.filter(event => event.kind === "response" && event.usageAvailable !== true).length, rejectionEvents: journal.filter(event => event.kind === "rejection" && !event.cached).length, cachedRejectionEvents: journal.filter(event => event.kind === "rejection" && event.cached).length };
    const candidates = outputFiles.filter(file => file.startsWith(`${id}-`) && /^\d+\.json$/.test(file.slice(id.length + 1))).filter(file => { const time = Number(file.slice(id.length + 1, -5)); return time >= Date.parse(report.startedAt) && time <= Date.parse(report.measuredAt); }).sort((a, b) => Number(b.slice(id.length + 1, -5)) - Number(a.slice(id.length + 1, -5)));
    if (!["partial", "complete"].includes(measurement.status)) {
      documents.push({ id, status: measurement.status, freshJournal: fresh, plannedSections: extractionChunks(parsed).length, attemptedSections: measurement.status === "not_attempted" ? 0 : null, validatedSections: null, rejectedSections: null, failedTargets: null, retainedOutputAvailable: false, limitation: "No returned quotation is available to attribute exact failed target sections. Fresh journal counts are preserved separately; request dispatches are not silently treated as unique sections." });
      continue;
    }
    if (!candidates.length) throw new Error("A recorded retained quotation has no corresponding private output within the finalized phase interval.");
    const bytes = await readExact(path.join(privateDirectory, "outputs", candidates[0])), quotation = JSON.parse(bytes.toString("utf8")) as Quotation;
    if (quotation.documentId !== id || quotation.contentHash !== fixture.sha256 || canonical(scoreExtraction(fixture, quotation, parsed)) !== canonical(measurement.score)) throw new Error("The retained quotation does not match the recorded document or score.");
    documents.push({ id, status: measurement.status, retainedOutputAvailable: true, retainedOutputSha256: sha(bytes), freshJournal: fresh, ...auditRetainedQuotation(quotation, parsed) });
  }
  const audit = { version: 1, name, auditedAt: new Date().toISOString(), reportSha256: sha(reportBytes), journalSha256: sha(journalBytes), auditCodeSha256: sha(await readFile(fileURLToPath(import.meta.url))), configurationHash: report.configuration.sha256, providerCalls: 0, heldoutReads: 0, documents, limitations: ["Counts describe section validation and partial availability, not proof of semantic extraction correctness.", "Readonly context references are excluded from failed-target denominators. Field-reference resolvability does not prove that the source supports a claim.", "Validated/rejected section counts come from returned quotation metadata and exact static issue-to-chunk checks; fresh journal dispatch/response counts are reported separately and include failures.", "No raw quotations, supplier values or rejected replies are published by this audit.", "No returned output means exact section attribution is unavailable; the audit does not infer it from response counts."] };
  await writeImmutableJson(path.join(directory, "section-audit.json"), audit);
  const rows = documents.map(document => `| ${document.id} | ${document.status} | ${document.plannedSections} | ${document.attemptedSections ?? "unavailable"} | ${document.validatedSections ?? "unavailable"} | ${document.rejectedSections ?? "unavailable"} | ${document.failedTargets ? `${document.failedTargets.numerator}/${document.failedTargets.denominator}` : "unavailable"} |`).join("\n");
  await writeFile(path.join(directory, "section-audit.md"), `# Retained-section audit\n\nFinalized report SHA-256: \`${audit.reportSha256}\`. Audit code SHA-256: \`${audit.auditCodeSha256}\`. No provider calls or held-out reads.\n\n| Document | Status | Planned | Attempted | Validated | Rejected | Failed targets / all targets |\n|---|---|---:|---:|---:|---:|---:|\n${rows}\n\n${audit.limitations.map(limitation => `- ${limitation}`).join("\n")}\n\nThe [sanitized JSON audit](section-audit.json) contains source-array hashes, exact target-set checks, field-reference counts and the deterministic coverage-gate probe.\n`, { flag: "wx" });
  return audit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--name") { console.error("Use --name <finalized-development-experiment>."); process.exitCode = 1; }
  else auditDevelopmentSections(args[1]).then(() => console.log("Sanitized section audit written.")).catch(error => { console.error(error instanceof Error ? error.message : "Section audit failed."); process.exitCode = 1; });
}
