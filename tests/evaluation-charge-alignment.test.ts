import { describe, expect, it } from "vitest";
import { alignQuotationCharges, chargeEvidenceLocationsOverlap } from "../eval/charge-alignment";
import { absent, emptyQuotation, field, type Charge, type SourceSpan } from "@/lib/domain/types";

const source = (id: string, start: number, documentId = "quote"): SourceSpan => ({ id, documentId, kind: "text", text: "Synthetic charge", start, end: start + 20 });
const charge = (id: string, kind: Charge["kind"], span: SourceSpan, amount = "10"): Charge => ({ id, label: kind, kind, amount: field(amount, [span.id]), currency: field("USD", [span.id]), appliesTo: "quotation" });
function setup() {
  const shipping = source("shipping", 0), tax = source("tax", 30), quotation = emptyQuotation("quote", "quote.txt");
  quotation.sources = [shipping, tax]; quotation.charges = [charge("gold-shipping", "shipping", shipping), charge("gold-tax", "tax", tax)];
  const expected = { quotation, fieldLocations: { "charges.0.amount": [structuredClone(shipping)], "charges.1.amount": [structuredClone(tax)] } };
  const actual = { documentId: "quote", charges: [charge("actual-tax", "tax", tax), charge("actual-shipping", "shipping", shipping)] };
  const parsed = { documentId: "quote", sources: [shipping, tax] };
  return { expected, actual, parsed, shipping, tax };
}
describe("conservative charge alignment for separate evaluation", () => {
  it("aligns reordered equal-price charges by context and location without mutating inputs", () => {
    const input = setup(), before = JSON.stringify(input), result = alignQuotationCharges(input.expected, input.actual, input.parsed);
    expect(result.mappedChargeIndices).toEqual({ "0": 1, "1": 0 }); expect(result.coverage).toEqual({ numerator: 2, denominator: 2, value: 1 }); expect(result.unmatchedActualIndices).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
    input.actual.charges[1].amount.value = "999";
    expect(alignQuotationCharges(input.expected, input.actual, input.parsed).mappedChargeIndices).toEqual({ "0": 1, "1": 0 }); // Accuracy is scored after alignment.
  });
  it("cannot substitute wrong-kind equal amounts even on the same summary location", () => {
    const { expected, actual, parsed, shipping } = setup();
    actual.charges = [charge("tax", "tax", shipping)];
    const result = alignQuotationCharges(expected, actual, parsed);
    expect(result.coverage).toMatchObject({ numerator: 0, denominator: 2 }); expect(result.entries.every(entry => entry.actualIndex === null)).toBe(true); expect(result.unmatchedActualIndices).toEqual([0]);
  });
  it("requires currency, application and billing period agreement, plus explicit recurring context", () => {
    for (const change of [ (value: Charge) => { value.currency = field("EUR"); }, (value: Charge) => { value.currency = absent(); }, (value: Charge) => { value.appliesTo = "unknown"; }, (value: Charge) => { value.billingPeriod = "monthly"; } ]) {
      const { expected, actual, parsed } = setup(); change(actual.charges[1]); expect(alignQuotationCharges(expected, actual, parsed).entries[0].actualIndex).toBeNull();
    }
    const { expected, actual, parsed } = setup(); expected.quotation.charges[0].kind = "recurring"; actual.charges[1].kind = "recurring";
    expect(alignQuotationCharges(expected, actual, parsed).entries[0].reason).toBe("unknown_commercial_context");
    expected.quotation.charges[0].billingPeriod = "Per month"; actual.charges[1].billingPeriod = " PER   MONTH ";
    expect(alignQuotationCharges(expected, actual, parsed).entries[0].actualIndex).toBe(1);
  });
  it("retains missing and evidence-free not-stated charges in the expected denominator", () => {
    const { expected, actual, parsed } = setup(); actual.charges = [];
    expect(alignQuotationCharges(expected, actual, parsed).coverage).toMatchObject({ numerator: 0, denominator: 2 }); expect(actual.charges).toEqual([]);
    actual.charges = structuredClone(expected.quotation.charges); actual.charges[0].amount = absent();
    const result = alignQuotationCharges(expected, actual, parsed); expect(result.coverage).toMatchObject({ numerator: 1, denominator: 2 }); expect(result.entries[0].reason).toBe("missing_or_invalid_evidence"); expect(actual.charges[0].amount.sourceIds).toEqual([]);
  });
  it("does not choose between duplicate actual charges or reuse one actual charge for duplicate expected charges", () => {
    const { expected, actual, parsed } = setup(); actual.charges.push({ ...structuredClone(actual.charges[1]), id: "duplicate" });
    const result = alignQuotationCharges(expected, actual, parsed); expect(result.entries[0]).toMatchObject({ status: "ambiguous", actualIndex: null, candidateCount: 2 }); expect(result.coverage).toMatchObject({ numerator: 1, denominator: 2 });
    const reverse = setup(); reverse.expected.quotation.charges.push({ ...structuredClone(reverse.expected.quotation.charges[0]), id: "duplicate-gold" });
    expect(alignQuotationCharges(reverse.expected, reverse.actual, reverse.parsed).entries.filter(entry => entry.status === "ambiguous")).toHaveLength(2);
  });
  it("requires an independently supplied item mapping for item-scoped charges", () => {
    const { expected, actual, parsed } = setup(); Object.assign(expected.quotation.charges[0], { appliesTo: "item", itemId: "gold-item" }); Object.assign(actual.charges[1], { appliesTo: "item", itemId: "actual-item" });
    expect(alignQuotationCharges(expected, actual, parsed).entries[0].reason).toBe("unknown_commercial_context");
    expect(alignQuotationCharges(expected, actual, parsed, { mappedItemIds: { "gold-item": "actual-item" } }).entries[0].actualIndex).toBe(1);
    expect(alignQuotationCharges(expected, actual, parsed, { mappedItemIds: { "gold-item": "other-item" } }).entries[0].actualIndex).toBeNull();
  });
  it("fails closed on wrong location, dangling evidence and cross-document or duplicate source IDs", () => {
    const { expected, actual, parsed } = setup(); actual.charges[1].amount.sourceIds = ["tax"];
    expect(alignQuotationCharges(expected, actual, parsed).entries[0].reason).toBe("evidence_location_mismatch");
    actual.charges[1].amount.sourceIds = ["unknown"];
    expect(alignQuotationCharges(expected, actual, parsed).entries[0].reason).toBe("missing_or_invalid_evidence");
    parsed.sources[0].documentId = "other"; expect(alignQuotationCharges(expected, actual, parsed).entries.every(entry => entry.reason === "invalid_document_identity")).toBe(true);
    const duplicate = setup(); duplicate.parsed.sources.push(structuredClone(duplicate.parsed.sources[0])); expect(alignQuotationCharges(duplicate.expected, duplicate.actual, duplicate.parsed).coverage.numerator).toBe(0);
  });
  it("uses exact sheet cells and meaningful PDF/text regions rather than page-only agreement", () => {
    const a: SourceSpan = { id: "a", documentId: "quote", kind: "sheet", text: "10", sheet: "Fees", cell: "$C$4" }, b = { ...a, id: "b", cell: "C4" };
    expect(chargeEvidenceLocationsOverlap(a, b)).toBe(true); expect(chargeEvidenceLocationsOverlap(a, { ...b, cell: "C5" })).toBe(false);
    const page: SourceSpan = { id: "a", documentId: "quote", kind: "pdf_text", text: "10", page: 1, pageWidth: 600, pageHeight: 800, box: { x: 100, y: 100, width: 100, height: 20 } };
    expect(chargeEvidenceLocationsOverlap(page, { ...page, id: "gold", pageWidth: 1200, pageHeight: 1600, box: { x: 200, y: 200, width: 200, height: 40 } })).toBe(true);
    expect(chargeEvidenceLocationsOverlap(page, { ...page, box: undefined })).toBe(false);
    expect(chargeEvidenceLocationsOverlap({ ...page, box: { x: 0, y: 0, width: 600, height: 800 } }, page)).toBe(false);
    expect(chargeEvidenceLocationsOverlap(source("whole", 0), source("adjacent", 20))).toBe(false);
    expect(chargeEvidenceLocationsOverlap({ ...source("whole", 0), end: 2000 }, source("small", 0))).toBe(false);
  });
});
