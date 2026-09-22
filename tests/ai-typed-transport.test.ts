import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { expandTypedExtraction, typedExtractionInstruction, typedExtractionWireSchemaForTargets } from "@/lib/ai/typed-transport";
import { extractionWireSchema } from "@/lib/ai/transport";
import { extractQuotation } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";

interface Fact { key: string; state: "value" | "not_stated" | "ambiguous" | "not_applicable"; value: string | null; raw: string | null; sourceIds: string[]; }
interface Attribute extends Fact { type: "text" | "decimal" | "date" | "boolean"; }
interface Item { sourceIds: string[]; kind: "goods" | "service"; fields: Fact[]; attributes: Attribute[]; taxBasis: "inclusive" | "not_stated"; tiers: { min: string; max: string | null; unitPrice: string; unit: string; basis: "all_units"; sourceIds: string[] }[]; discounts: { kind: "percent"; value: string; basis: "unit"; alreadyIncluded: boolean; sourceIds: string[] }[]; }
interface Charge { label: string; kind: "shipping"; fields: Fact[]; attributes: Attribute[]; billingPeriod: string | null; appliesTo: "quotation" | "item"; itemSourceId: string | null; }
interface Wire { supplier: Fact[]; quotation: Fact[]; terms: Fact[]; attributes: Attribute[]; items: Item[]; charges: Charge[]; excluded: { sourceIds: string[]; disposition: "header"; reason: string }[]; uncertainties: { message: string; sourceIds: string[] }[]; }
const targets = ["s0", "s1", "s2"], known = [...targets, "context"];
const fact = (key: string, value: string, sourceId = "s2"): Fact => ({ key, state: "value", value, raw: value, sourceIds: [sourceId] });
function wire(): Wire {
  return { supplier: [fact("name", "Pine Tools", "s0")], quotation: [fact("currency", "USD", "s1")], terms: [], attributes: [],
    items: [{ sourceIds: ["s2"], kind: "goods", fields: [fact("description", "Widget"), fact("quantity", "2"), fact("unit", "each"), fact("unitPrice", "10"), fact("lineAmount", "20"), fact("minimumOrder", "2")], attributes: [], taxBasis: "inclusive", tiers: [], discounts: [] }], charges: [], excluded: [], uncertainties: [] };
}
function shipping(): Charge { return { label: "Shipping", kind: "shipping", fields: [fact("amount", "5"), fact("currency", "USD", "s1")], attributes: [], billingPeriod: null, appliesTo: "quotation", itemSourceId: null }; }
const schema = () => typedExtractionWireSchemaForTargets(targets, known);
async function integrate(data: Wire, taxWording = "Tax rate 9%") {
  const document = await parseDocument({ documentId: "typed-synthetic", filename: "synthetic.txt", text: `Supplier: Pine Tools\nCurrency: USD\nWidget quantity 2 each unit price 10 amount 20 minimum order 2 each tax inclusive; no travel; shipping 5; ${taxWording}` });
  const mapped = structuredClone(data);
  function references(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "sourceIds" && Array.isArray(child)) Object.assign(value, { sourceIds: child.map(id => document.sources[targets.indexOf(id)]?.id ?? id) });
      else references(child);
    }
  }
  references(mapped);
  return extractQuotation(document, { request: async request => {
    const body = JSON.parse(request.user) as { sources: { id: string }[]; context: { id: string }[] };
    return { data: expandTypedExtraction(mapped, body.sources.map(source => source.id), body.context.map(source => source.id)), model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
  } });
}

describe("typed section-aware quotation transport", () => {
  it("constrains core decimal strings where the older generic wire accepts unit-bearing MOQ text", () => {
    const data = wire(), minimum = data.items[0].fields.find(field => field.key === "minimumOrder")!;
    minimum.value = "2 each";
    expect(extractionWireSchema.shape.items.element.shape.fields.element.safeParse({ ...minimum, type: "text" }).success).toBe(true);
    expect(schema().safeParse(data).success).toBe(false);
    expect(() => expandTypedExtraction(data, targets)).toThrow(/typed quotation transport schema/);
  });

  it.each(["1,250", "1e3", "2 / each", "9%", "2-5"])("rejects noncanonical decimal %s without stripping text or changing magnitude", value => {
    const data = wire(); data.items[0].fields.find(field => field.key === "quantity")!.value = value;
    expect(schema().safeParse(data).success).toBe(false);
  });

  it("keeps canonical zero and decimal precision as strings with unchanged narrow excerpts", () => {
    const data = wire(); Object.assign(data.items[0].fields.find(field => field.key === "unitPrice")!, { value: "0.1250", raw: "0.1250" });
    data.items[0].fields.find(field => field.key === "minimumOrder")!.value = "0";
    const decoded = expandTypedExtraction(data, targets);
    expect(decoded.items[0].fields.find(field => field.key === "unitPrice")).toMatchObject({ type: "decimal", value: "0.1250", raw: "0.1250", sourceIds: ["s2"] });
    expect(decoded.items[0].fields.find(field => field.key === "minimumOrder")!.value).toBe("0");
  });

  it("rejects misplaced core fields but retains item exclusions in their own attribute scope", () => {
    const data = wire(); data.items[0].fields.push(fact("exclusions", "no travel"));
    expect(schema().safeParse(data).success).toBe(false);
    data.items[0].fields.pop(); data.items[0].attributes.push({ ...fact("exclusions", "no travel"), type: "text" });
    const decoded = expandTypedExtraction(data, targets);
    expect(decoded.items[0].attributes).toContainEqual(expect.objectContaining({ key: "exclusions", type: "text", value: "no travel", raw: "no travel", sourceIds: ["s2"] }));
    expect(decoded.terms).toEqual([]); expect(JSON.stringify(decoded)).not.toContain("__fieldops_attribute_");
  });

  it("keeps charge tax rates as labelled attributes, never as charge amounts", () => {
    const data = wire(); data.charges.push(shipping()); data.charges[0].fields.push(fact("taxRate", "9"));
    expect(schema().safeParse(data).success).toBe(false);
    data.charges[0].fields.pop(); data.charges[0].attributes.push({ ...fact("taxRate", "9"), type: "decimal", raw: "9%" });
    const decoded = expandTypedExtraction(data, targets);
    expect(decoded.charges[0].fields.map(field => field.key)).toEqual(["amount", "currency"]);
    expect(decoded.attributes).toContainEqual(expect.objectContaining({ key: "taxRate", label: "Shipping: taxRate", type: "decimal", value: "9", raw: "9%", sourceIds: ["s2"] }));
  });

  it("preserves root and item industry attributes and counts their actual evidence toward coverage", () => {
    const data = wire(); data.attributes.push({ ...fact("document_context", "Context", "context"), type: "text" });
    data.items[0].attributes.push({ ...fact("specification", "no travel"), type: "text" });
    const decoded = expandTypedExtraction(data, targets, ["context"]);
    expect(decoded.attributes[0]).toMatchObject({ key: "document_context", value: "Context", sourceIds: ["context"] });
    expect(decoded.items[0].attributes[0].key).toBe("specification");
    expect(decoded.coverage.every(row => row.disposition === "used")).toBe(true);
  });

  it("constrains every citation and item-specific charge reference to known sources, and exclusions to targets", () => {
    const data = wire(); data.charges.push({ ...shipping(), appliesTo: "item", itemSourceId: "foreign-source" });
    expect(schema().safeParse(data).success).toBe(false);
    data.charges = []; data.items[0].fields[0].sourceIds = ["foreign-source"];
    expect(schema().safeParse(data).success).toBe(false);
    expect(() => expandTypedExtraction(data, targets)).toThrow();
    data.items[0].fields[0].sourceIds = ["s2"]; data.excluded.push({ sourceIds: ["context"], disposition: "header", reason: "Wrong target" });
    expect(schema().safeParse(data).success).toBe(false);
  });

  it("rejects duplicate core fields, repeated source IDs and contradictory absent states", () => {
    const duplicated = wire(); duplicated.items[0].fields.push(fact("quantity", "2"));
    expect(() => expandTypedExtraction(duplicated, targets)).toThrow(/repeated field/);
    const repeated = wire(); repeated.items[0].fields[0].sourceIds = ["s2", "s2"];
    expect(() => expandTypedExtraction(repeated, targets)).toThrow(/reference/);
    const absent = wire(); absent.items[0].fields[0].state = "not_stated";
    expect(() => expandTypedExtraction(absent, targets)).toThrow(/state/);
  });

  it("bounds item count and price-rule decimal lexemes", () => {
    const data = wire(); data.items = Array.from({ length: 4 }, () => structuredClone(data.items[0]));
    expect(() => expandTypedExtraction(data, targets)).toThrow(/three items/);
    data.items.splice(1); data.items[0].tiers.push({ min: "2 each", max: null, unitPrice: "8", unit: "each", basis: "all_units", sourceIds: ["s2"] });
    expect(schema().safeParse(data).success).toBe(false);
    data.items[0].tiers = []; data.items[0].discounts.push({ kind: "percent", value: "9%", basis: "unit", alreadyIncluded: false, sourceIds: ["s2"] });
    expect(schema().safeParse(data).success).toBe(false);
  });

  it("defers exact raw, numeric and tax evidence to the unchanged domain validators", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const badRaw = wire(); badRaw.items[0].fields[0].raw = "Invented column label: Widget";
      expect(expandTypedExtraction(badRaw, targets).items).toHaveLength(1);
      await expect(integrate(badRaw)).rejects.toMatchObject({ code: "invalid_evidence" });
      const badNumber = wire(); badNumber.items[0].fields.find(field => field.key === "unitPrice")!.value = "100";
      await expect(integrate(badNumber)).rejects.toMatchObject({ code: "invalid_evidence" });
      const tax = wire(); tax.charges.push(shipping()); tax.charges[0].attributes.push({ ...fact("taxRate", "9"), type: "decimal", raw: "9%" });
      await expect(integrate(tax, "discount 9%")).rejects.toMatchObject({ code: "invalid_evidence" });
      const good = await integrate(tax); expect(good.attributes.find(attribute => attribute.key === "taxRate")!.value.value).toBe("9");
    } finally { info.mockRestore(); }
  });

  it("emits required closed objects with shared definitions within the fixed request budget", () => {
    const json = z.toJSONSchema(schema(), { target: "draft-7", reused: "ref" }); delete json.$schema;
    const patterns: string[] = [];
    function inspect(value: unknown): void {
      if (!value || typeof value !== "object") return;
      const node = value as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; pattern?: string };
      if (node.type === "object") { expect(node.additionalProperties).toBe(false); expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties ?? {}).sort()); }
      if (node.pattern) patterns.push(node.pattern);
      Object.values(value).forEach(inspect);
    }
    inspect(json); expect(patterns).toContain(/^-?\d+(?:\.\d+)?$/.source);
    expect(JSON.stringify(json).length + typedExtractionInstruction.length).toBeLessThan(9700);
    expect(typedExtractionInstruction).toContain("shortest EXACT excerpt");
  });
});
