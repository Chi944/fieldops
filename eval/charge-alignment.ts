import type { FixtureRecord } from "../scripts/generate-fixtures";
import type { Charge, ParsedDocument, Quotation, SourceSpan } from "../src/lib/domain/types";

export type ChargeAlignmentReason = "unique_context_and_location" | "missing_charge" | "unknown_commercial_context" | "context_mismatch" | "missing_or_invalid_evidence" | "evidence_location_mismatch" | "ambiguous_candidates" | "invalid_document_identity";
export interface ChargeAlignmentEntry {
  expectedIndex: number;
  actualIndex: number | null;
  status: "aligned" | "unmatched" | "ambiguous";
  reason: ChargeAlignmentReason;
  candidateCount: number;
}
export interface ChargeAlignmentResult {
  version: "fieldops-charge-alignment-1";
  /** Only mutually unique matches appear here. Keys/values are charge indices. */
  mappedChargeIndices: Record<string, number>;
  entries: ChargeAlignmentEntry[];
  coverage: { numerator: number; denominator: number; value: number | null };
  unmatchedActualIndices: number[];
  limitations: string[];
}
type Gold = Pick<FixtureRecord, "quotation" | "fieldLocations">;
type Actual = Pick<Quotation, "documentId" | "charges">;
type Parsed = Pick<ParsedDocument, "documentId" | "sources">;
const normalized = (text: string) => text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const currency = (charge: Charge) => charge.currency.state === "value" && typeof charge.currency.value === "string" && /^[A-Z]{3}$/.test(charge.currency.value.trim().toUpperCase()) ? charge.currency.value.trim().toUpperCase() : null;
const period = (charge: Charge) => charge.billingPeriod?.trim() ? normalized(charge.billingPeriod) : null;
const cell = (address: string | undefined) => address && /^\$?[A-Z]+\$?[1-9]\d*$/i.test(address) ? address.replaceAll("$", "").toUpperCase() : null;
function finitePositive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }

/** Require a meaningful location overlap. Page-only agreement and matching
 * source text are insufficient; source text is never used as an identity key.
 */
export function chargeEvidenceLocationsOverlap(actual: SourceSpan, expected: SourceSpan): boolean {
  if (actual.documentId !== expected.documentId) return false;
  if (actual.sheet || expected.sheet) return Boolean(actual.sheet && actual.sheet === expected.sheet && cell(actual.cell) && cell(actual.cell) === cell(expected.cell));
  if (actual.start !== undefined || expected.start !== undefined) {
    if (actual.kind !== "text" || expected.kind !== "text" || actual.start === undefined || actual.end === undefined || expected.start === undefined || expected.end === undefined) return false;
    const values = [actual.start, actual.end, expected.start, expected.end];
    if (values.some(value => !Number.isSafeInteger(value) || value < 0) || actual.end <= actual.start || expected.end <= expected.start) return false;
    const overlap = Math.min(actual.end, expected.end) - Math.max(actual.start, expected.start);
    const midpoint = (actual.start + actual.end) / 2;
    return overlap / (actual.end - actual.start) >= 0.5 && midpoint >= expected.start && midpoint < expected.end;
  }
  if (!Number.isSafeInteger(actual.page) || !actual.page || actual.page !== expected.page || (actual.rotation ?? 0) !== (expected.rotation ?? 0)) return false;
  if (!actual.box || !expected.box || !finitePositive(actual.pageWidth) || !finitePositive(actual.pageHeight) || !finitePositive(expected.pageWidth) || !finitePositive(expected.pageHeight)) return false;
  function region(source: SourceSpan) {
    const box = source.box!;
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || box.x < 0 || box.y < 0 || !finitePositive(box.width) || !finitePositive(box.height) || box.x + box.width > source.pageWidth! || box.y + box.height > source.pageHeight!) return null;
    return { left: box.x / source.pageWidth!, right: (box.x + box.width) / source.pageWidth!, top: box.y / source.pageHeight!, bottom: (box.y + box.height) / source.pageHeight! };
  }
  const a = region(actual), e = region(expected); if (!a || !e) return false;
  const width = Math.max(0, Math.min(a.right, e.right) - Math.max(a.left, e.left));
  const height = Math.max(0, Math.min(a.bottom, e.bottom) - Math.max(a.top, e.top));
  const centerX = (a.left + a.right) / 2, centerY = (a.top + a.bottom) / 2;
  return width * height / ((a.right - a.left) * (a.bottom - a.top)) >= 0.5 && centerX >= e.left && centerX <= e.right && centerY >= e.top && centerY <= e.bottom;
}

function compatibleContext(expected: Charge, actual: Charge, mappedItemIds: Readonly<Record<string, string>>) {
  if (expected.kind !== actual.kind || expected.appliesTo !== actual.appliesTo) return false;
  if (expected.appliesTo === "unknown" || !currency(expected) || !currency(actual) || currency(expected) !== currency(actual)) return false;
  if (period(expected) !== period(actual) || (expected.kind === "recurring" && !period(expected))) return false;
  // The broad "other" category needs its exact normalized label as an extra
  // discriminator. Do not infer synonymous fee names or convert billing periods.
  if (expected.kind === "other" && (!normalized(expected.label) || normalized(expected.label) !== normalized(actual.label))) return false;
  if (expected.appliesTo === "item") return Boolean(expected.itemId && actual.itemId && mappedItemIds[expected.itemId] === actual.itemId);
  return true;
}
function knownExpectedContext(charge: Charge, mappedItemIds: Readonly<Record<string, string>>) {
  return charge.appliesTo !== "unknown" && Boolean(currency(charge)) && (charge.kind !== "recurring" || Boolean(period(charge))) && (charge.appliesTo !== "item" || Boolean(charge.itemId && mappedItemIds[charge.itemId]));
}

/** Align before scoring values. Amount equality, array order and generated IDs
 * never decide identity. Every expected charge remains in the denominator.
 * Evidence-free not-stated placeholders remain unmatched; no absence is made up.
 */
export function alignQuotationCharges(expected: Gold, actual: Actual, parsed: Parsed, options: { mappedItemIds?: Readonly<Record<string, string>> } = {}): ChargeAlignmentResult {
  const mappedItemIds = options.mappedItemIds ?? {}, expectedCharges = expected.quotation.charges;
  const sourceMap = new Map(parsed.sources.map(source => [source.id, source]));
  const goldSources = new Map(expected.quotation.sources.map(source => [source.id, source]));
  const documentValid = expected.quotation.documentId === parsed.documentId && actual.documentId === parsed.documentId && sourceMap.size === parsed.sources.length && parsed.sources.every(source => source.documentId === parsed.documentId);
  const candidates: number[][] = [], zeroReasons: ChargeAlignmentReason[] = [];
  for (let expectedIndex = 0; expectedIndex < expectedCharges.length; expectedIndex++) {
    const gold = expectedCharges[expectedIndex], annotation = `charges.${expectedIndex}.amount`;
    const locations = Object.hasOwn(expected.fieldLocations, annotation) ? expected.fieldLocations[annotation] : gold.amount.sourceIds.map(id => goldSources.get(id)).filter((source): source is SourceSpan => Boolean(source));
    let reason: ChargeAlignmentReason = "context_mismatch";
    const matches: number[] = [];
    if (!documentValid) reason = "invalid_document_identity";
    else if (!knownExpectedContext(gold, mappedItemIds)) reason = "unknown_commercial_context";
    else if (!actual.charges.length) reason = "missing_charge";
    else if (!locations?.length || locations.some(source => source.documentId !== parsed.documentId)) reason = "missing_or_invalid_evidence";
    else for (let actualIndex = 0; actualIndex < actual.charges.length; actualIndex++) {
      const candidate = actual.charges[actualIndex];
      if (!compatibleContext(gold, candidate, mappedItemIds)) continue;
      const ids = candidate.amount.sourceIds;
      if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !sourceMap.has(id))) { reason = "missing_or_invalid_evidence"; continue; }
      if (!ids.some(id => locations.some(location => chargeEvidenceLocationsOverlap(sourceMap.get(id)!, location)))) { reason = "evidence_location_mismatch"; continue; }
      matches.push(actualIndex);
    }
    candidates.push(matches); zeroReasons.push(reason);
  }
  const expectedIdCounts = new Map<string, number>(), actualIdCounts = new Map<string, number>();
  expectedCharges.forEach(charge => expectedIdCounts.set(charge.id, (expectedIdCounts.get(charge.id) ?? 0) + 1));
  actual.charges.forEach(charge => actualIdCounts.set(charge.id, (actualIdCounts.get(charge.id) ?? 0) + 1));
  const actualDegree = new Map<number, number>(); candidates.flat().forEach(index => actualDegree.set(index, (actualDegree.get(index) ?? 0) + 1));
  const mappedChargeIndices: Record<string, number> = {};
  const entries: ChargeAlignmentEntry[] = candidates.map((matches, expectedIndex) => {
    if (!matches.length) return { expectedIndex, actualIndex: null, status: "unmatched", reason: zeroReasons[expectedIndex], candidateCount: 0 };
    const unique = matches.length === 1 && actualDegree.get(matches[0]) === 1 && expectedIdCounts.get(expectedCharges[expectedIndex].id) === 1 && actualIdCounts.get(actual.charges[matches[0]].id) === 1;
    if (!unique) return { expectedIndex, actualIndex: null, status: "ambiguous", reason: "ambiguous_candidates", candidateCount: matches.length };
    mappedChargeIndices[String(expectedIndex)] = matches[0];
    return { expectedIndex, actualIndex: matches[0], status: "aligned", reason: "unique_context_and_location", candidateCount: 1 };
  });
  const used = new Set(Object.values(mappedChargeIndices)), numerator = used.size, denominator = expectedCharges.length;
  return { version: "fieldops-charge-alignment-1", mappedChargeIndices, entries, coverage: { numerator, denominator, value: denominator ? numerator / denominator : null }, unmatchedActualIndices: actual.charges.map((_, index) => index).filter(index => !used.has(index)),
    limitations: ["Alignment identifies annotated charge candidates; it does not score amount accuracy or prove semantic entailment.", "Only mutually unique context-and-location candidates align. Duplicates and shared evidence ambiguity remain unmatched; no best-price or positional tie-break is used.", "Currency must be stated, application scope known, and recurring billing period explicit. Item charges require an independently supplied item mapping. Missing context does not rank favourably.", "Absent periods on both non-recurring charges mean no period assertion, not a fabricated one-time term. Period wording is compared exactly after case/whitespace normalization; no equivalence or conversion is inferred.", "Only amount evidence establishes charge location. Currency headers, page-only citations, missing containers and evidence-free not-stated placeholders do not prove alignment or verified absence.", "The denominator includes every expected charge; unaligned actual charges remain explicit. This helper does not mutate quotations or historical metrics."] };
}
