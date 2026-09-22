import Ajv from "ajv";
import { describe, expect, it, vi } from "vitest";
import { expandFactExtraction, factExtractionInstruction, factExtractionWireSchemaForTargets, factProviderSchema } from "@/lib/ai/fact-transport";
import { extractQuotation } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import { calculateComparison } from "@/lib/domain/calculate";
import { proposeMatches } from "@/lib/domain/matching";
import type { Comparison, Quotation } from "@/lib/domain/types";

type Section = "supplier" | "quotation" | "terms" | "item" | "charge" | "tier" | "discount";
interface Fact { section: Section; entity: string; key: string; type: "text" | "decimal" | "date" | "boolean"; state: "value" | "ambiguous" | "not_stated" | "not_applicable"; value: string | null; raw: string | null; sourceIds: string[]; }
interface Wire { facts: Fact[]; excluded: { sourceIds: string[]; disposition: "header"; reason: string }[]; uncertainties: { sourceIds: string[]; message: string }[]; }
const targets = ["s0", "s1", "s2", "s3", "s4", "s5"], known = [...targets, "context"];
function comparisonOf(quotation: Quotation): Comparison { return { id: "fact-comparison", workspaceId: "synthetic", name: "Fact comparison", description: "", createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z", revision: 1, isDemo: false, quotations: [quotation], groups: proposeMatches([quotation]).map(group => ({ ...group, status: "approved", classification: "equivalent", approvedRevision: 1 })), corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } }; }
function fact(section: Section, entity: string, key: string, value: string, source = "s2", type: Fact["type"] = "text", raw = value): Fact { return { section, entity, key, value, raw, type, state: "value", sourceIds: [source] }; }
function wire(): Wire {
  return { facts: [fact("supplier", "document", "name", "Acme", "s0"), fact("quotation", "document", "currency", "USD", "s1"),
    fact("item", "i1", "description", "Widget"), fact("item", "i1", "identifier", "W-1"), fact("item", "i1", "quantity", "2", "s2", "decimal"), fact("item", "i1", "unit", "each"), fact("item", "i1", "unitPrice", "10", "s2", "decimal"), fact("item", "i1", "lineAmount", "20", "s2", "decimal"), fact("item", "i1", "taxBasis", "inclusive", "s2", "text", "tax inclusive")], excluded: [{ sourceIds: ["s3", "s4", "s5"], disposition: "header", reason: "Unused synthetic records" }], uncertainties: [] };
}
function rules(data: Wire) {
  data.excluded = data.excluded.map(entry => ({ ...entry, sourceIds: entry.sourceIds.filter(id => !["s3", "s4"].includes(id)) }));
  for (const [key, value, type, raw] of [["min", "10", "decimal", "10"], ["max", "19", "decimal", "19"], ["unitPrice", "8", "decimal", "8"], ["unit", "each", "text", "each"], ["basis", "all_units", "text", "all units"]] as const) data.facts.push(fact("tier", "i1:t1", key, value, "s3", type, raw));
  for (const [key, value, type, raw] of [["kind", "percent", "text", "5%"], ["value", "5", "decimal", "5"], ["basis", "unit", "text", "unit discount"], ["alreadyIncluded", "false", "boolean", "not included"]] as const) data.facts.push(fact("discount", "i1:d1", key, value, "s4", type, raw));
}
async function integrate(data: Wire, mutateText?: (text: string) => string): Promise<Quotation> {
  const text = "Supplier: Acme\nCurrency: USD\nWidget W-1 quantity 2 each unit price 10 line amount 20; tax inclusive; no travel; installation only\nTier: 10-19 each unit price 8 for all units\n5% unit discount not included\nShipping fee 5 USD per quotation; billed monthly";
  const parsed = await parseDocument({ documentId: "fact-synthetic", filename: "quote.txt", text: mutateText?.(text) ?? text });
  const dataCopy = structuredClone(data);
  for (const f of dataCopy.facts) f.sourceIds = f.sourceIds.map(id => parsed.sources[targets.indexOf(id)]?.id ?? id);
  dataCopy.excluded.forEach(e => { e.sourceIds = e.sourceIds.map(id => parsed.sources[targets.indexOf(id)]?.id ?? id); });
  return extractQuotation(parsed, { request: async request => {
    const body = JSON.parse(request.user) as { sources: { id: string }[]; context: { id: string }[] };
    const targetIds = body.sources.map(s => s.id), knownIds = new Set([...targetIds, ...body.context.map(s => s.id)]);
    const itemEntities = new Set(dataCopy.facts.filter(f => f.section === "item" && ["description", "identifier"].includes(f.key) && f.sourceIds.some(id => targetIds.includes(id))).map(f => f.entity));
    const facts = dataCopy.facts.filter(f => f.sourceIds.every(id => knownIds.has(id)) && (["supplier", "quotation", "terms"].includes(f.section) || f.section === "item" ? f.section !== "item" || itemEntities.has(f.entity) : f.section === "charge" ? f.sourceIds.some(id => targetIds.includes(id)) : itemEntities.has(f.entity.split(":")[0])));
    const response = { ...dataCopy, facts, excluded: dataCopy.excluded.map(e => ({ ...e, sourceIds: e.sourceIds.filter(id => targetIds.includes(id)) })).filter(e => e.sourceIds.length) };
    return { data: expandFactExtraction(response, targetIds, body.context.map(s => s.id)), model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
  } });
}

describe("homogeneous fact ledger transport", () => {
  it("has one closed fact shape with no refs or unions and fits the existing request budget", () => {
    const schema = factProviderSchema(factExtractionWireSchemaForTargets(targets, known));
    expect(JSON.stringify(schema)).not.toMatch(/"(?:\$ref|anyOf|oneOf|allOf|definitions|\$defs)"/);
    const object = schema.properties as Record<string, { items: Record<string, unknown> }>;
    expect(Object.keys(object.facts.items.properties as object).sort()).toEqual(["section", "entity", "key", "type", "state", "value", "raw", "sourceIds"].sort());
    expect(object.facts.items.additionalProperties).toBe(false);
    expect(object.facts.items.required).toHaveLength(8);
    expect(new Ajv().compile(schema)(wire())).toBe(true);
    expect(JSON.stringify(schema).length + factExtractionInstruction.length).toBeLessThan(7500);
  });

  it("routes core facts and attributes without inventing item anchors or flattening scope", () => {
    const data = wire(); data.facts.push(fact("item", "i1", "scope", "installation only"), fact("item", "i1", "exclusions", "no travel"), fact("supplier", "document", "certification", "ISO", "context"));
    const result = expandFactExtraction(data, targets, ["context"]);
    expect(result.items).toHaveLength(1); expect(result.items[0].sourceIds).toEqual(["s2"]); expect(result.items[0].kind).toBe("unknown");
    expect(result.items[0].fields.find(f => f.key === "scope")?.value).toBe("installation only");
    expect(result.items[0].attributes).toContainEqual(expect.objectContaining({ key: "exclusions", raw: "no travel", sourceIds: ["s2"] }));
    expect(result.attributes).toContainEqual(expect.objectContaining({ key: "certification", label: expect.stringContaining("supplier"), sourceIds: ["context"] }));
    expect(result.terms).toEqual([]);
  });

  it.each(["2 each", "1,250", "1e3", "9%"])("rejects noncanonical core decimal %s without lexical repair", value => {
    const data = wire(); data.facts.find(f => f.key === "quantity")!.value = value;
    expect(() => expandFactExtraction(data, targets)).toThrow(/decimal/);
  });

  it("does not drop unexpected fact properties, contradictory states or foreign citations", () => {
    const extra = wire(); Object.assign(extra.facts[0], { billingPeriod: "monthly" }); expect(() => expandFactExtraction(extra, targets)).toThrow();
    const state = wire(); state.facts[0].state = "not_stated"; expect(() => expandFactExtraction(state, targets)).toThrow(/state/);
    const unknown = wire(); unknown.facts[0].sourceIds = ["other-document"]; expect(() => expandFactExtraction(unknown, targets)).toThrow();
    const context = wire(); context.excluded.push({ sourceIds: ["context"], disposition: "header", reason: "Wrong target" }); expect(() => expandFactExtraction(context, targets, ["context"])).toThrow();
  });

  it("rejects duplicate facts, namespace collisions and orphan rule entities", () => {
    const duplicate = wire(); duplicate.facts.push(structuredClone(duplicate.facts[0])); expect(() => expandFactExtraction(duplicate, targets)).toThrow(/duplicate/i);
    const clash = wire(); clash.facts.push(fact("charge", "i1", "amount", "5", "s5", "decimal")); expect(() => expandFactExtraction(clash, targets)).toThrow(/entity/i);
    const orphan = wire(); orphan.facts.push(fact("tier", "missing:t1", "min", "10", "s3", "decimal")); expect(() => expandFactExtraction(orphan, targets)).toThrow(/parent/i);
  });

  it("retains misplaced core facts visibly while blocking their sources from complete interpretation", () => {
    const data = wire(); data.facts.push(fact("supplier", "document", "quantity", "2", "s2", "decimal"), fact("quotation", "document", "scope", "installation only"), fact("charge", "c1", "amount", "5", "s5", "decimal"), fact("charge", "c1", "unitPrice", "5", "s5", "decimal")); data.excluded[0].sourceIds = ["s3", "s4"];
    const result = expandFactExtraction(data, targets);
    expect(result.supplier.some(f => (f.key as string) === "quantity")).toBe(false);
    expect(result.attributes).toContainEqual(expect.objectContaining({ key: "quantity", label: "supplier: quantity", value: "2", raw: "2" }));
    expect(result.attributes).toContainEqual(expect.objectContaining({ key: "unitPrice", value: "5" }));
    expect(result.coverage.filter(c => ["s2", "s5"].includes(c.sourceId)).every(c => c.disposition === "uninterpreted")).toBe(true);
  });

  it("requires target description or identifier evidence and bounds item count", () => {
    const contextOnly = wire(); contextOnly.facts.filter(f => f.section === "item" && ["description", "identifier"].includes(f.key)).forEach(f => { f.sourceIds = ["context"]; });
    expect(() => expandFactExtraction(contextOnly, targets, ["context"])).toThrow(/target|description|identifier/i);
    const many = wire(); for (let i = 2; i <= 4; i++) many.facts.push(fact("item", `i${i}`, "description", "Widget"));
    expect(() => expandFactExtraction(many, targets)).toThrow(/three items/i);
  });

  it("preserves complete tiers and discounts with exact numbers, bounds and explicit metadata", () => {
    const data = wire(); rules(data); const result = expandFactExtraction(data, targets);
    expect(result.items[0].tiers).toEqual([{ min: "10", max: "19", unitPrice: "8", unit: "each", basis: "all_units", sourceIds: ["s3"] }]);
    expect(result.items[0].discount).toEqual({ kind: "percent", value: "5", basis: "unit", alreadyIncluded: false, sourceIds: ["s4"] });
    expect(result.items[0].attributes).toContainEqual(expect.objectContaining({ key: "tier.t1.min", type: "decimal", raw: "10", sourceIds: ["s3"] }));
    expect(result.coverage.some(c => c.disposition === "uninterpreted")).toBe(false);
  });

  it("supports explicitly unbounded tiers but never invents missing metadata or silently combines discounts", () => {
    const open = wire(); rules(open); const max = open.facts.find(f => f.section === "tier" && f.key === "max")!; Object.assign(max, { state: "not_applicable", value: null, raw: "10+" });
    expect(expandFactExtraction(open, targets).items[0].tiers[0].max).toBeNull();
    const incomplete = wire(); rules(incomplete); incomplete.facts = incomplete.facts.filter(f => !(f.section === "discount" && f.key === "alreadyIncluded"));
    const secondDiscount = incomplete.facts.filter(f => f.section === "discount").map(f => ({ ...f, entity: "i1:d2" })); incomplete.facts.push(...secondDiscount);
    const result = expandFactExtraction(incomplete, targets);
    expect(result.items[0].discount).toBeNull(); expect(result.items[0].attributes.some(a => a.key === "discount.d1.value")).toBe(true);
    expect(result.coverage.find(c => c.sourceId === "s4")?.disposition).toBe("uninterpreted");
  });

  it("routes charges and resolves item applicability only to an existing description/id anchor", () => {
    const data = wire(); data.excluded[0].sourceIds = ["s3", "s4"];
    data.facts.push(fact("charge", "c1", "amount", "5", "s5", "decimal"), fact("charge", "c1", "currency", "USD", "s1"), fact("charge", "c1", "kind", "shipping", "s5", "text", "Shipping"), fact("charge", "c1", "label", "Shipping", "s5"), fact("charge", "c1", "appliesTo", "item", "s5", "text", "fee"), fact("charge", "c1", "itemEntity", "i1", "s5", "text", "fee"));
    const result = expandFactExtraction(data, targets); expect(result.charges[0]).toMatchObject({ kind: "shipping", appliesTo: "item", itemSourceId: "s2" });
    data.facts.find(f => f.key === "itemEntity")!.value = "missing"; expect(() => expandFactExtraction(data, targets)).toThrow(/item|parent/i);
  });

  it("keeps all original evidence checks and makes incomplete rule recovery block price ranking", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const valid = wire(); rules(valid); const quotation = await integrate(valid); expect(quotation.items[0].tiers).toHaveLength(1); expect(quotation.items[0].discount?.value).toBe("5");
      const raw = wire(); raw.facts[2].raw = "Invented label: Widget"; await expect(integrate(raw)).rejects.toMatchObject({ code: "invalid_evidence" });
      const numeric = wire(); numeric.facts.find(f => f.key === "unitPrice")!.value = "100"; await expect(integrate(numeric)).rejects.toMatchObject({ code: "invalid_evidence" });
      const incomplete = wire(); rules(incomplete); incomplete.facts = incomplete.facts.filter(f => !(f.section === "discount" && f.key === "alreadyIncluded"));
      const partial = await integrate(incomplete); expect(partial.status).toBe("partial"); expect(partial.items[0].discount).toBeNull(); expect(partial.issues.some(i => !i.resolved && i.code === "incomplete_extraction")).toBe(true);
      const comparison = comparisonOf(partial);
      expect(calculateComparison(comparison).groups[0].values[0].status).toBe("needs_review");
    } finally { info.mockRestore(); }
  });

  it("retains ambiguous charge metadata as a blocking source-linked issue through calculation", async () => {
    const data = wire(); data.excluded[0].sourceIds = ["s3", "s4"];
    data.facts.push(fact("charge", "c1", "amount", "5", "s5", "decimal"), fact("charge", "c1", "currency", "USD", "s5"), fact("charge", "c1", "kind", "shipping", "s5", "text", "Shipping"), fact("charge", "c1", "appliesTo", "quotation", "s5", "text", "per quotation"), { ...fact("charge", "c1", "billingPeriod", "monthly", "s5", "text", "billed monthly"), state: "ambiguous", value: null });
    const quote = await integrate(data);
    expect(quote.status).toBe("partial"); expect(quote.attributes.find(a => a.key === "metadata.billingPeriod")?.value.state).toBe("ambiguous");
    expect(quote.issues.some(issue => issue.code === "incomplete_extraction" && /Charge metadata/.test(issue.message) && issue.sourceIds.length > 0)).toBe(true);
    const comparison = comparisonOf(quote);
    expect(calculateComparison(comparison).groups[0].values[0].status).toBe("needs_review");
  });
});
