import { describe, expect, it } from "vitest";
import { extractionSchema, sectionFieldKeys, strictSchema } from "@/lib/ai/schema";
import { emptyItem } from "@/lib/domain/types";
import { compactExtractionRequest } from "@/lib/ai/groq";

describe("section-specific structured extraction", () => {
  it("uses the same required wire properties in every field and attribute context", () => {
    const shape = extractionSchema.shape;
    const schemas = [shape.supplier.element, shape.quotation.element, shape.terms.element, shape.items.element.shape.fields.element, shape.charges.element.shape.fields.element, shape.attributes.element];
    for (const schema of schemas) expect(Object.keys(schema.shape).sort()).toEqual(["key", "label", "raw", "sourceIds", "state", "type", "unit", "value"]);
  });
  it("round-trips transport aliases to exact parser references and rejects invented aliases", () => {
    const originalId = "document-uuid:pdf:p2:fragment-42";
    const wire = compactExtractionRequest({ purpose: "extraction", schema: {}, system: "Test", user: JSON.stringify({ sources: [{ id: originalId, text: "USD 12.50", page: 2 }] }), maxOutputTokens: 20 });
    expect(JSON.parse(wire.request.user).sources[0]).toEqual({ id: "s0", text: "USD 12.50", page: 2 });
    expect(wire.restore({ fields: [{ sourceIds: ["s0"], raw: "s0 stays raw" }], coverage: [{ sourceId: "s0" }], itemSourceId: null })).toEqual({ fields: [{ sourceIds: [originalId], raw: "s0 stays raw" }], coverage: [{ sourceId: originalId }], itemSourceId: null });
    expect(() => wire.restore({ sourceIds: ["s999"] })).toThrow("Unknown evidence alias");
    expect(() => wire.restore({ sourceIds: [originalId] })).toThrow("Unknown evidence alias");
  });
  it("rejects the observed live taxRate-in-charge failure at the decoding contract", () => {
    const field = { key: "taxRate", state: "not_stated", value: null, raw: null, sourceIds: [] };
    const data = { supplier: [], quotation: [], terms: [], items: [], charges: [{ label: "Tax", kind: "tax", fields: [field], billingPeriod: null, appliesTo: "quotation", itemSourceId: null }], attributes: [], coverage: [], uncertainties: [] };
    expect(extractionSchema.safeParse(data).success).toBe(false);
    const valid = structuredClone(data); valid.charges[0].fields = [];
    expect(extractionSchema.safeParse(valid).success).toBe(true);
    const schema = strictSchema(extractionSchema) as { properties: { charges: { items: { properties: { fields: { items: { properties: { key: { enum: string[] } } } } } } } } };
    expect(schema.properties.charges.items.properties.fields.items.properties.key.enum).toEqual(["amount", "currency"]);
  });

  it("covers actual item fields without permitting supplier fields in item data", () => {
    const actual = Object.keys(emptyItem("shape")).filter(key => !["id", "kind", "taxBasis", "tiers", "discount", "attributes", "sourceIds"].includes(key));
    expect([...sectionFieldKeys.item].sort()).toEqual(actual.sort());
    const data = { supplier: [], quotation: [], terms: [], items: [{ kind: "goods", sourceIds: [], fields: [{ key: "name", state: "value", value: "Wrong section", raw: "Wrong section", sourceIds: ["source"] }], taxBasis: "not_stated", tiers: [], discount: null, attributes: [] }], charges: [], attributes: [], coverage: [], uncertainties: [] };
    expect(extractionSchema.safeParse(data).success).toBe(false);
  });
});
