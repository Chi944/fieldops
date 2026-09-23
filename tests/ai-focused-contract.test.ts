import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { compactExtractionRequest, type AIRequest } from "@/lib/ai/groq";
import { focusedBillingRequiresReview } from "@/lib/ai/focused-contract";

interface Field { state: "value" | "not_stated" | "ambiguous" | "not_applicable"; value: string | null; raw: string | null; sourceIds: string[]; }
const absent = (): Field => ({ state: "not_stated", value: null, raw: null, sourceIds: [] });
const stated = (value: string, raw = value): Field => ({ state: "value", value, raw, sourceIds: ["s0"] });
function item() {
  return { description: stated("Inspection"), identifier: stated("IN-9"), quantity: stated("2"), unit: stated("hour"), unitPrice: stated("25"), lineAmount: stated("50"), currency: stated("USD"),
    packageSize: absent(), packageUnit: absent(), minimumOrder: absent(), orderIncrement: absent(), billingBasis: stated("per hour"), duration: absent(), scope: stated("Inspect equipment"), leadTime: absent(), taxRate: absent(),
    kind: "service", taxBasis: "not_stated", attributes: [], tiers: [], discounts: [] };
}
function request(): AIRequest {
  return { purpose: "extraction", transport: "quotation-v10", schema: {}, system: "Contract regression", maxOutputTokens: 2400,
    user: JSON.stringify({ task: "items", sources: [{ id: "original-a", text: "Inspection IN-9 2 hour 25 50 USD per hour Inspect equipment 6 units per package", slot: "i1" }], context: [] }) };
}

describe("focused fixed item contract at the provider boundary", () => {
  it("rejects unit-bearing optional numbers before they reach the typed adapter", () => {
    const validate = new Ajv().compile(compactExtractionRequest(request()).request.schema);
    const good = { items: { i1: item() }, uncertainties: [] };
    expect(validate(good)).toBe(true);
    for (const key of ["packageSize", "minimumOrder", "orderIncrement", "taxRate"] as const) {
      const bad = structuredClone(good); bad.items.i1[key] = stated("6 each");
      expect(validate(bad), key).toBe(false);
    }
    const zero = structuredClone(good); zero.items.i1.minimumOrder = stated("0");
    expect(validate(zero)).toBe(true);
  });

  it("requires an explicit billing state and refuses duplicate core-field lists", () => {
    const validate = new Ajv().compile(compactExtractionRequest(request()).request.schema);
    const missing: Record<string, unknown> = item(); delete missing.billingBasis;
    expect(validate({ items: { i1: missing }, uncertainties: [] })).toBe(false);
    expect(validate({ items: { i1: { ...item(), billingBasis: absent() } }, uncertainties: [] })).toBe(true);
    const duplicates = { ...item(), fields: [{ key: "scope", ...stated("Inspect equipment") }, { key: "scope", ...stated("Different scope") }] };
    expect(validate({ items: { i1: duplicates }, uncertainties: [] })).toBe(false);
  });

  it("preserves original raw text and parser references during typed expansion", () => {
    const wire = compactExtractionRequest(request()), input = { items: { i1: item() }, uncertainties: [] };
    input.items.i1.packageSize = stated("6", "6 units per package");
    const before = structuredClone(input);
    const expanded = wire.restore(input) as { items: { fields: (Field & { key: string })[] }[] };
    expect(input).toEqual(before);
    expect(expanded.items[0].fields.find(field => field.key === "packageSize")).toMatchObject({ state: "value", value: "6", raw: "6 units per package", sourceIds: ["original-a"] });
    expect(expanded.items[0].fields.find(field => field.key === "billingBasis")).toMatchObject({ value: "per hour", sourceIds: ["original-a"] });
    expect(expanded.items[0].fields.filter(field => field.key === "scope")).toHaveLength(1);
  });

  it("requires billing wording from the claimed family without filling or changing the assertion", () => {
    const cases = [
      { value: "hourly", raw: "hourly", text: "Billing basis: hourly", review: false },
      { value: "hourly", raw: "hourly", text: "Hourly rate USD 25", review: false },
      { value: "hourly", raw: "per hour", text: "USD 25 per hour", review: false },
      { value: "hourly", raw: "hour", text: "Billing basis: hour", review: false },
      { value: "fixed_project", raw: "fixed fee", text: "Fixed fee USD 50", review: false },
      { value: "hourly", raw: "hour", text: "Unit: hour", review: true },
      { value: "hourly", raw: "hourly", text: "Hourly inspection", review: true },
      { value: "hourly", raw: "monthly fee", text: "Monthly fee USD 50", review: true },
      { value: "hourly", raw: "hourly", text: "Hourly or fixed fee", review: true },
      { value: "hourly", raw: "hourly", text: "Not an hourly rate", review: true },
      { value: "hourly", raw: "hourly", text: "Non-hourly rate", review: true },
      { value: "hourly", raw: "hourly", text: "Without an hourly rate", review: true },
      { value: "hourly", raw: "hourly", text: "Hourly rate excluded", review: true },
      { value: "hourly", raw: "hourly", text: "Hourly rate isn't applicable", review: true },
      { value: "hourly", raw: "hourly", text: "Hourly rate isn’t applicable", review: true },
      { value: "monthly", raw: "monthly", text: "Monthly report delivered", review: true },
    ];
    for (const test of cases) {
      const field = { ...stated(test.value, test.raw), origin: "supplier" as const }, before = structuredClone(field);
      const source = { id: "s0", documentId: "q", kind: "text" as const, text: test.text, start: 0, end: test.text.length };
      expect(focusedBillingRequiresReview(field, new Map([["s0", source]])), test.text).toBe(test.review);
      expect(field).toEqual(before);
    }
  });
});
