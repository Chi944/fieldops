import type { FixtureRecord } from "../scripts/generate-fixtures";
import type { FieldValue, ParsedDocument, Quotation, SourceSpan } from "../src/lib/domain/types";
import { resolveField } from "../src/lib/domain/corrections";
import { canonical, fraction, scoreExtraction } from "./metrics";
import { decimal } from "../src/lib/domain/calculate";

function locationSupports(actual: SourceSpan, expected: SourceSpan): boolean {
  if (actual.documentId !== expected.documentId) return false;
  if (expected.sheet) return actual.sheet === expected.sheet && actual.cell === expected.cell;
  if (expected.start !== undefined) return actual.start !== undefined && actual.start >= expected.start && actual.start <= (expected.end ?? expected.start);
  if (actual.page !== expected.page) return false;
  if (!expected.box) return true;
  // Known precise gold locations cannot fall back to page-only agreement.
  if (!actual.box || !actual.pageWidth || !actual.pageHeight || !expected.pageWidth || !expected.pageHeight) return false;
  const x = (actual.box.x + actual.box.width / 2) / actual.pageWidth, y = (actual.box.y + actual.box.height / 2) / actual.pageHeight;
  return x >= expected.box.x / expected.pageWidth - 0.01 && x <= (expected.box.x + expected.box.width) / expected.pageWidth + 0.01 && y >= expected.box.y / expected.pageHeight - 0.01 && y <= (expected.box.y + expected.box.height) / expected.pageHeight + 0.01;
}
const numericFields = new Set(["quantity", "unitPrice", "lineAmount", "packageSize", "minimumOrder", "statedSubtotal", "statedTotal", "amount"]);
/** A new, fixed-denominator gate alongside historical metrics. Passing verifies
 * the selected gold annotations, not every unannotated commercial assertion.
 */
export function auditExtractionReadiness(expected: FixtureRecord, actual: Quotation, parsed: ParsedDocument) {
  const score = scoreExtraction(expected, actual, parsed), sourceMap = new Map(parsed.sources.map(source => [source.id, source]));
  const critical = expected.fields.filter(field => field.critical && field.state === "value");
  const criticalNonValues = expected.fields.filter(field => field.critical && field.state !== "value");
  const supportedPaths = new Set<string>();
  let correctCritical = 0, correctNonValues = 0, sourceLinkedNonValues = 0, totalReferences = 0, resolvableReferences = 0, unsourcedStatedFields = 0;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("state" in value && "sourceIds" in value && Array.isArray(value.sourceIds)) {
      const field = value as FieldValue;
      if (field.state === "value" && !field.sourceIds.length) unsourcedStatedFields++;
      totalReferences += field.sourceIds.length; resolvableReferences += field.sourceIds.filter(id => sourceMap.get(id)?.documentId === parsed.documentId).length;
      return;
    }
    for (const [key, child] of Object.entries(value)) if (!["sources", "issues", "originalText"].includes(key)) visit(child);
  }
  visit(actual);
  for (const gold of critical) {
    const parts = gold.path.split(".");
    if (parts[0] === "items") { const mapped = score.mappedItems[parts[1]]; if (!mapped) continue; parts[1] = mapped; }
    let field: FieldValue;
    try { field = resolveField(actual, parts.join(".")); } catch { continue; }
    const equal = numericFields.has(parts.at(-1)!) ? Boolean(decimal(field.value)?.eq(decimal(gold.value) ?? "NaN")) : canonical(field.value ?? "") === canonical(gold.value ?? "");
    if (field.state !== "value" || !equal) continue;
    correctCritical++;
    if (field.sourceIds.length && field.sourceIds.every(id => sourceMap.get(id)?.documentId === parsed.documentId) && field.sourceIds.some(id => expected.fieldLocations[gold.path]?.some(location => locationSupports(sourceMap.get(id)!, location)))) supportedPaths.add(gold.path);
  }
  for (const gold of criticalNonValues) {
    const parts = gold.path.split(".");
    if (parts[0] === "items") { const mapped = score.mappedItems[parts[1]]; if (!mapped) continue; parts[1] = mapped; }
    // Do not turn an absent charge container into a fabricated not-stated charge,
    // or match the non-value state of a different kind of charge at that index.
    if (parts[0] === "charges" && actual.charges[Number(parts[1])]?.kind !== expected.quotation.charges[Number(parts[1])]?.kind) continue;
    let field: FieldValue;
    try { field = resolveField(actual, parts.join(".")); } catch { continue; }
    if (field.state !== gold.state) continue;
    correctNonValues++;
    const locations = expected.fieldLocations[gold.path] ?? [];
    if (field.raw?.trim() && field.sourceIds.length && field.sourceIds.every(id => sourceMap.get(id)?.documentId === parsed.documentId) && field.sourceIds.some(id => {
      const source = sourceMap.get(id)!;
      return source.text.includes(field.raw!) && (!locations.length || locations.some(location => locationSupports(source, location)));
    })) sourceLinkedNonValues++;
  }
  const completeItems = expected.quotation.items.filter(item => {
    const required = critical.filter(field => field.path.startsWith(`items.${item.id}.`));
    return Boolean(score.mappedItems[item.id]) && required.length > 0 && required.every(field => supportedPaths.has(field.path));
  }).length;
  const allSourcesPreserved = JSON.stringify(actual.sources) === JSON.stringify(parsed.sources);
  const blockers = actual.issues.filter(issue => !issue.resolved && (issue.severity === "error" || ["incomplete_extraction", "unverified_evidence"].includes(issue.code))).length;
  const fullItemRecall = score.lineItemRecall.numerator === expected.quotation.items.length;
  const noExtraItems = score.lineItemPrecision.numerator === actual.items.length;
  const criticalComplete = critical.length > 0 && supportedPaths.size === critical.length;
  // The wire deliberately represents not_stated as no assertion, with no raw
  // citation. State agreement is checkable; verified absence is not implied.
  const nonValuesComplete = correctNonValues === criticalNonValues.length;
  return { version: "fieldops-readiness-2", passesSelectedAnnotationGate: actual.status === "ready" && parsed.manifest.complete && actual.manifest.complete && fullItemRecall && noExtraItems && completeItems === expected.quotation.items.length && criticalComplete && nonValuesComplete && allSourcesPreserved && !blockers && !unsourcedStatedFields && totalReferences === resolvableReferences,
    applicationReady: actual.status === "ready", parserComplete: parsed.manifest.complete, fullItemRecall: score.lineItemRecall, completeExpectedItems: fraction(completeItems, expected.quotation.items.length), correctCriticalStatedFields: fraction(correctCritical, critical.length), evidenceBackedCriticalStatedFields: fraction(supportedPaths.size, critical.length), correctCriticalNonValueStates: fraction(correctNonValues, criticalNonValues.length), sourceLinkedCriticalNonValueStates: fraction(sourceLinkedNonValues, criticalNonValues.length), unverifiedCriticalNonValueStates: correctNonValues - sourceLinkedNonValues, allFieldReferenceResolvability: fraction(resolvableReferences, totalReferences), unsourcedStatedFields, extraOrUnalignedItems: actual.items.length - score.lineItemPrecision.numerator, unresolvedBlockingIssues: blockers, originalSourcesPreserved: allSourcesPreserved,
    limitations: ["This separate gate preserves historical metric values and fixed expected denominators, including missing rows and uncited fields.", "Identifier alignment is necessary, not sufficient: every annotated critical stated item field must also be correct and source-linked.", "Critical non-value state agreement is separate from evidence. Missing containers are not backfilled. The wire's not_stated is absence of an assertion, not evidence of verified absence; matching unsourced states remain unverified. Non-value source linkage is diagnostic and is not required by this annotation gate. Never invent a charge or citation to satisfy it.", "Location agreement establishes a recorded location, not semantic entailment. Material unannotated descriptions, scope, discounts, tiers and terms still require independent review.", "Passing the selected-annotation gate is not proof of universal document completeness or permission to enable production AI."] };
}
