import { describe, expect, it } from "vitest";
import { auditExtractionReadiness } from "../eval/readiness";
import { scoreExtraction } from "../eval/metrics";
import { absent, emptyItem, emptyQuotation, field, type ParsedDocument } from "@/lib/domain/types";
import type { FixtureRecord } from "../scripts/generate-fixtures";

function fixture() {
  const quote = emptyQuotation("readiness", "synthetic.pdf");
  const source = { id: "row", documentId: quote.id, kind: "pdf_text" as const, text: "Widget A-1 quantity 2 unit price 10 line amount 20", page: 1, pageWidth: 600, pageHeight: 800, box: { x: 40, y: 80, width: 400, height: 20 } };
  quote.status = "ready"; quote.sources = [source]; quote.manifest = { parserVersion: "synthetic", units: [{ id: "page", label: "Page 1", status: "parsed", sourceCount: 1 }], complete: true, warnings: [] };
  const item = emptyItem("item"); item.identifier = field("A-1", [source.id]); item.quantity = field("2", [source.id]); item.unitPrice = field("10", [source.id]); item.lineAmount = field("20", [source.id]); quote.items = [item];
  const fields = ["identifier", "quantity", "unitPrice", "lineAmount"].map(key => ({ path: `items.item.${key}`, state: "value" as const, value: item[key as "identifier"].value, critical: true }));
  const expected = { id: quote.id, quotation: structuredClone(quote), fields, fieldLocations: Object.fromEntries(fields.map(value => [value.path, [structuredClone(source)]])), ambiguities: [] } as unknown as FixtureRecord;
  const parsed: ParsedDocument = { documentId: quote.id, filename: quote.filename, format: "text_pdf", contentHash: "synthetic", sources: quote.sources, manifest: quote.manifest };
  return { expected, actual: structuredClone(quote), parsed };
}
function missingShippingFixture() {
  const result = fixture();
  const source = { ...structuredClone(result.parsed.sources[0]), id: "shipping-source", text: "Shipping not stated", box: { x: 40, y: 120, width: 250, height: 20 } };
  result.parsed.sources.push(source); result.actual.sources = structuredClone(result.parsed.sources);
  result.expected.quotation.charges = [{ id: "shipping", kind: "shipping", label: "Shipping", appliesTo: "quotation", amount: absent(), currency: absent() }];
  result.expected.fields.push({ path: "charges.0.amount", state: "not_stated", value: null, critical: true, sourceKey: "shipping" });
  result.expected.fieldLocations["charges.0.amount"] = [structuredClone(source)];
  return { ...result, source };
}
describe("separate fixed-denominator extraction readiness audit", () => {
  it("passes correct annotated items with preserved precise sources", () => {
    const { expected, actual, parsed } = fixture(); const result = auditExtractionReadiness(expected, actual, parsed);
    expect(result.passesSelectedAnnotationGate).toBe(true); expect(result.evidenceBackedCriticalStatedFields).toMatchObject({ numerator: 4, denominator: 4 });
  });
  it("rejects identifier-only rows even when historical row recall is perfect", () => {
    const { expected, actual, parsed } = fixture(); actual.items[0].quantity = absent(); actual.items[0].unitPrice = absent(); actual.items[0].lineAmount = absent();
    expect(scoreExtraction(expected, actual, parsed).lineItemRecall.value).toBe(1);
    const result = auditExtractionReadiness(expected, actual, parsed);
    expect(result.passesSelectedAnnotationGate).toBe(false); expect(result.completeExpectedItems).toMatchObject({ numerator: 0, denominator: 1 }); expect(result.correctCriticalStatedFields).toMatchObject({ numerator: 1, denominator: 4 });
  });
  it("keeps every critical field in the evidence denominator when citations are missing", () => {
    const { expected, actual, parsed } = fixture(); actual.items[0].quantity.sourceIds = []; actual.items[0].unitPrice.sourceIds = []; actual.items[0].lineAmount.sourceIds = [];
    expect(scoreExtraction(expected, actual, parsed).correctFieldLocationAgreement.value).toBe(1);
    const result = auditExtractionReadiness(expected, actual, parsed);
    expect(result.passesSelectedAnnotationGate).toBe(false); expect(result.correctCriticalStatedFields.value).toBe(1); expect(result.evidenceBackedCriticalStatedFields).toMatchObject({ numerator: 1, denominator: 4 });
  });
  it("does not convert known precise PDF gold locations into page-only successes", () => {
    const { expected, actual, parsed } = fixture(); delete parsed.sources[0].box; actual.sources = structuredClone(parsed.sources);
    expect(scoreExtraction(expected, actual, parsed).correctFieldLocationAgreement.value).toBe(1);
    expect(auditExtractionReadiness(expected, actual, parsed).evidenceBackedCriticalStatedFields).toMatchObject({ numerator: 0, denominator: 4 });
  });
  it("checks unscored field reference resolution and blocks incomplete-source output", () => {
    const { expected, actual, parsed } = fixture(); actual.attributes.push({ key: "extra", label: "Extra", type: "text", value: field("extra", ["unknown"]) });
    expect(scoreExtraction(expected, actual, parsed).sourceReferenceResolvability.value).toBe(1);
    const result = auditExtractionReadiness(expected, actual, parsed); expect(result.passesSelectedAnnotationGate).toBe(false); expect(result.allFieldReferenceResolvability).toMatchObject({ numerator: 4, denominator: 5 });
    actual.attributes = []; actual.status = "partial"; expect(auditExtractionReadiness(expected, actual, parsed).passesSelectedAnnotationGate).toBe(false);
  });
  it("rejects a source-linked invented shipping amount even when every stated critical field is correct", () => {
    const { expected, actual, parsed, source } = missingShippingFixture();
    actual.charges = [{ id: "shipping", kind: "shipping", label: "Shipping", appliesTo: "quotation", amount: field("10", [source.id]), currency: absent() }];
    const result = auditExtractionReadiness(expected, actual, parsed);
    expect(result.evidenceBackedCriticalStatedFields.value).toBe(1);
    expect(result.correctCriticalNonValueStates).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.passesSelectedAnnotationGate).toBe(false);
  });
  it("does not backfill missing containers and reports matching not-stated assertions as unverified", () => {
    const { expected, actual, parsed } = missingShippingFixture();
    const missing = auditExtractionReadiness(expected, actual, parsed);
    expect(actual.charges).toEqual([]); expect(missing.correctCriticalNonValueStates).toMatchObject({ numerator: 0, denominator: 1 }); expect(missing.passesSelectedAnnotationGate).toBe(false);
    actual.charges = structuredClone(expected.quotation.charges);
    const defaultState = auditExtractionReadiness(expected, actual, parsed);
    expect(defaultState.correctCriticalNonValueStates).toMatchObject({ numerator: 1, denominator: 1 }); expect(defaultState.sourceLinkedCriticalNonValueStates).toMatchObject({ numerator: 0, denominator: 1 }); expect(defaultState.unverifiedCriticalNonValueStates).toBe(1); expect(defaultState.passesSelectedAnnotationGate).toBe(true);
  });
  it("does not mistake another kind of charge's not-stated amount for the expected shipping state", () => {
    const { expected, actual, parsed } = missingShippingFixture();
    actual.charges = structuredClone(expected.quotation.charges);
    actual.charges[0].kind = "tax";
    const result = auditExtractionReadiness(expected, actual, parsed);
    expect(result.correctCriticalNonValueStates).toMatchObject({ numerator: 0, denominator: 1 }); expect(result.passesSelectedAnnotationGate).toBe(false);
  });
});
