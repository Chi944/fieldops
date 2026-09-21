import Ajv from "ajv";
import { describe, expect, it, vi } from "vitest";
import { expandPartitionedExtraction, partitionedExtractionInstruction, partitionedExtractionWireSchemaForTargets } from "@/lib/ai/partitioned-transport";
import { expandTypedExtraction, typedExtractionWireSchemaForTargets } from "@/lib/ai/typed-transport";
import { typedProviderSchema } from "@/lib/ai/provider-schema";
import { extractQuotation } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";

interface Fact { key: string; state: "value" | "not_stated" | "ambiguous" | "not_applicable"; value: string | null; raw: string | null; sourceIds: string[]; }
interface TextAttribute extends Fact { type: "text" | "date" | "boolean"; }
interface Attributes { decimal: Fact[]; text: TextAttribute[]; }
interface Fields { numeric: Fact[]; text: Fact[]; }
interface Item { sourceIds: string[]; kind: "goods" | "service"; fields: Fields; attributes: Attributes; taxBasis: "inclusive" | "not_stated"; tiers: { min: string; max: string | null; unitPrice: string; unit: string; basis: "all_units"; sourceIds: string[] }[]; discounts: { kind: "percent"; value: string; basis: "unit"; alreadyIncluded: boolean; sourceIds: string[] }[]; }
interface Charge { label: string; kind: "shipping"; fields: Fields; attributes: Attributes; billingPeriod: string | null; appliesTo: "quotation" | "item"; itemSourceId: string | null; }
interface Wire { supplier: Fact[]; quotation: Fields; terms: Fact[]; attributes: Attributes; items: Item[]; charges: Charge[]; excluded: { sourceIds: string[]; disposition: "header"; reason: string }[]; uncertainties: { message: string; sourceIds: string[] }[]; }
const targets = ["s0", "s1", "s2"], known = [...targets, "context"];
const fact = (key: string, value: string, sourceId = "s2"): Fact => ({ key, state: "value", value, raw: value, sourceIds: [sourceId] });
const attributes = (): Attributes => ({ decimal: [], text: [] });
function wire(): Wire {
  return { supplier: [fact("name", "Pine Tools", "s0")], quotation: { numeric: [], text: [fact("currency", "USD", "s1")] }, terms: [], attributes: attributes(),
    items: [{ sourceIds: ["s2"], kind: "goods", fields: { numeric: [fact("quantity", "2"), fact("unitPrice", "10"), fact("lineAmount", "20"), fact("minimumOrder", "2")], text: [fact("description", "Widget"), fact("unit", "each")] }, attributes: attributes(), taxBasis: "inclusive", tiers: [], discounts: [] }], charges: [], excluded: [], uncertainties: [] };
}
function shipping(): Charge { return { label: "Shipping", kind: "shipping", fields: { numeric: [fact("amount", "5")], text: [fact("currency", "USD", "s1")] }, attributes: attributes(), billingPeriod: null, appliesTo: "quotation", itemSourceId: null }; }
function asV1(data: Wire) {
  const fields = (value: Fields) => [...value.numeric, ...value.text];
  const attrs = (value: Attributes) => [...value.decimal.map(field => ({ ...field, type: "decimal" as const })), ...value.text];
  return { ...data, quotation: fields(data.quotation), attributes: attrs(data.attributes), items: data.items.map(item => ({ ...item, fields: fields(item.fields), attributes: attrs(item.attributes) })), charges: data.charges.map(charge => ({ ...charge, fields: fields(charge.fields), attributes: attrs(charge.attributes) })) };
}
const schema = () => partitionedExtractionWireSchemaForTargets(targets, known);
async function integrate(data: Wire, taxWording = "Tax rate 9%") {
  const parsed = await parseDocument({ documentId: "partitioned-synthetic", filename: "quotation.txt", text: `Supplier: Pine Tools\nCurrency: USD\nWidget quantity 2 each unit price 10 amount 20 minimum order 2 each tax inclusive; no travel; shipping 5; ${taxWording}` });
  const mapped = structuredClone(data);
  function references(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "sourceIds" && Array.isArray(child)) Object.assign(value, { sourceIds: child.map(id => parsed.sources[targets.indexOf(id)]?.id ?? id) });
      else references(child);
    }
  }
  references(mapped);
  return extractQuotation(parsed, { request: async request => {
    const body = JSON.parse(request.user) as { sources: { id: string }[]; context: { id: string }[] };
    return { data: expandPartitionedExtraction(mapped, body.sources.map(source => source.id), body.context.map(source => source.id)), model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
  } });
}

describe("partitioned typed quotation transport", () => {
  it("eliminates the observed competing-discriminator unions while retaining required closed objects and refs", () => {
    const legacyJson = typedProviderSchema(typedExtractionWireSchemaForTargets(targets, known));
    const json = typedProviderSchema(schema());
    expect(JSON.stringify(legacyJson)).toContain('"anyOf"');
    expect(JSON.stringify(json)).not.toMatch(/"(?:anyOf|oneOf|allOf)"/);
    let objects = 0;
    function inspect(value: unknown): void {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "object") { objects++; expect(node.additionalProperties).toBe(false); expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort()); }
      Object.values(value).forEach(inspect);
    }
    inspect(json); expect(objects).toBeGreaterThan(10); expect(JSON.stringify(json)).toContain('"$ref"');
    const validate = new Ajv({ allErrors: true }).compile(json);
    expect(validate(wire())).toBe(true);
    expect(JSON.stringify(json).length + partitionedExtractionInstruction.length).toBeLessThan(10000);
  });

  it("expands to exactly the same validated v1 facts including scoped attributes, rules and coverage", () => {
    const data = wire();
    data.attributes.text.push({ ...fact("context", "Context", "context"), type: "text" });
    data.items[0].attributes.text.push({ ...fact("exclusions", "no travel"), type: "text" });
    data.items[0].attributes.decimal.push(fact("tolerance", "0.1250"));
    data.items[0].tiers.push({ min: "2", max: null, unitPrice: "8", unit: "each", basis: "all_units", sourceIds: ["s2"] });
    data.items[0].discounts.push({ kind: "percent", value: "9", basis: "unit", alreadyIncluded: false, sourceIds: ["s2"] });
    data.charges.push(shipping()); data.charges[0].attributes.decimal.push({ ...fact("taxRate", "9"), raw: "9%" });
    expect(expandPartitionedExtraction(data, targets, ["context"])).toEqual(expandTypedExtraction(asV1(data), targets, ["context"]));
    expect(JSON.stringify(expandPartitionedExtraction(data, targets, ["context"]))).not.toContain("__fieldops_attribute_");
  });

  it.each(["2 each", "1,250", "1e3", "9%", "2-5"])("rejects noncanonical numeric %s in schema and runtime without repair", value => {
    const data = wire(); data.items[0].fields.numeric[0].value = value;
    expect(schema().safeParse(data).success).toBe(false);
    expect(new Ajv().compile(typedProviderSchema(schema()))(data)).toBe(false);
    expect(() => expandPartitionedExtraction(data, targets)).toThrow();
  });

  it("preserves zero, decimal precision and exact raw excerpts", () => {
    const data = wire(); data.items[0].fields.numeric[0] = fact("quantity", "0"); data.items[0].fields.numeric[1] = fact("unitPrice", "0.1250");
    const decoded = expandPartitionedExtraction(data, targets);
    expect(decoded.items[0].fields.find(field => field.key === "quantity")).toMatchObject({ value: "0", type: "decimal" });
    expect(decoded.items[0].fields.find(field => field.key === "unitPrice")).toMatchObject({ value: "0.1250", raw: "0.1250", sourceIds: ["s2"] });
  });

  it("enforces numeric/text partition keys and section ownership rather than moving fields", () => {
    const data = wire(); data.items[0].fields.text.push(fact("quantity", "2")); expect(schema().safeParse(data).success).toBe(false);
    data.items[0].fields.text.pop(); data.items[0].fields.numeric.push(fact("scope", "2")); expect(schema().safeParse(data).success).toBe(false);
    data.items[0].fields.numeric.pop(); data.quotation.text.push(fact("scope", "Installation")); expect(schema().safeParse(data).success).toBe(false);
    data.quotation.text.pop(); data.charges.push(shipping()); data.charges[0].fields.numeric.push(fact("taxRate", "9")); expect(schema().safeParse(data).success).toBe(false);
  });

  it("retains known-key numeric enforcement even if an attribute is placed in text", () => {
    const data = wire(); data.items[0].attributes.text.push({ ...fact("minimumOrder", "2 each"), type: "text" });
    expect(() => expandPartitionedExtraction(data, targets)).toThrow(/numeric attribute/);
  });

  it("keeps duplicate, state, bounded-item and commercial-rule validation in the original expander", () => {
    const duplicated = wire(); duplicated.items[0].fields.numeric.push(fact("quantity", "2")); expect(() => expandPartitionedExtraction(duplicated, targets)).toThrow(/repeated field/);
    const state = wire(); state.items[0].fields.numeric[0].state = "not_stated"; expect(() => expandPartitionedExtraction(state, targets)).toThrow(/state/);
    const count = wire(); count.items = Array.from({ length: 4 }, () => structuredClone(count.items[0])); expect(() => expandPartitionedExtraction(count, targets)).toThrow(/three items/);
    const tier = wire(); tier.items[0].tiers.push({ min: "2 each", max: null, unitPrice: "8", unit: "each", basis: "all_units", sourceIds: ["s2"] }); expect(schema().safeParse(tier).success).toBe(false);
    const discount = wire(); discount.items[0].discounts.push({ kind: "percent", value: "9%", basis: "unit", alreadyIncluded: false, sourceIds: ["s2"] }); expect(schema().safeParse(discount).success).toBe(false);
  });

  it("requires every partition and constrains field, attribute, charge and exclusion source IDs", () => {
    const data = wire();
    expect(schema().safeParse({ ...data, attributes: { text: [] } }).success).toBe(false);
    expect(schema().safeParse({ ...data, attributes: { decimal: [], text: [], extra: [] } }).success).toBe(false);
    data.items[0].fields.numeric[0].sourceIds = ["foreign"]; expect(schema().safeParse(data).success).toBe(false); data.items[0].fields.numeric[0].sourceIds = ["s2"];
    data.attributes.decimal.push(fact("tolerance", "2", "foreign")); expect(schema().safeParse(data).success).toBe(false); data.attributes.decimal = [];
    data.charges.push({ ...shipping(), itemSourceId: "foreign" }); expect(schema().safeParse(data).success).toBe(false); data.charges = [];
    data.excluded.push({ sourceIds: ["context"], disposition: "header", reason: "Invalid context exclusion" }); expect(schema().safeParse(data).success).toBe(false);
  });

  it("preserves downstream exact excerpt, numeric and tax-evidence rejection", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const raw = wire(); raw.items[0].fields.text[0].raw = "Invented label: Widget"; await expect(integrate(raw)).rejects.toMatchObject({ code: "invalid_evidence" });
      const numeric = wire(); numeric.items[0].fields.numeric[1].value = "100"; await expect(integrate(numeric)).rejects.toMatchObject({ code: "invalid_evidence" });
      const tax = wire(); tax.charges.push(shipping()); tax.charges[0].attributes.decimal.push({ ...fact("taxRate", "9"), raw: "9%" });
      await expect(integrate(tax, "discount 9%")).rejects.toMatchObject({ code: "invalid_evidence" });
      expect((await integrate(tax)).attributes.find(attribute => attribute.key === "taxRate")?.value.value).toBe("9");
    } finally { info.mockRestore(); }
  });
});
