import { describe, expect, it } from "vitest";
import { compactExtractionRequest, extractQuotation, extractionChunks, extractionContext, type AIRequest } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import { extractionSchema, strictSchema } from "@/lib/ai/schema";
import { expandExtraction, extractionInstruction, extractionWireSchema } from "@/lib/ai/transport";

const absent = () => ({ state: "not_stated", value: null as string | null, raw: null as string | null, sourceIds: [] as string[] });
const requiredEmpty = () => ({ description: absent(), identifier: absent(), quantity: absent(), unit: absent(), unitPrice: absent(), lineAmount: absent() });
const empty = () => ({ fields: [] as { key: string; type: string; state: string; value: string | null; raw: string | null; sourceIds: string[] }[], items: [] as { description: ReturnType<typeof absent>; identifier: ReturnType<typeof absent>; quantity: ReturnType<typeof absent>; unit: ReturnType<typeof absent>; unitPrice: ReturnType<typeof absent>; lineAmount: ReturnType<typeof absent>; kind: string; taxBasis: string; sourceIds: string[]; fields: ReturnType<typeof fact>[]; tiers: never[]; discounts: never[] }[], charges: [], excluded: [] as { sourceIds: string[]; disposition: string; reason: string }[], uncertainties: [] });
const fact = (key: string, value: string, sourceId: string) => ({ key, type: "text", state: "value", value, raw: value, sourceIds: [sourceId] });

describe("bounded extraction structure", () => {
  it("bounds dense priced rows independently of their character count", async () => {
    const parsed = await parseDocument({ documentId: "dense-synthetic", filename: "dense.txt", text: Array.from({ length: 18 }, (_, index) => `Part ${index + 1} | qty 2 each | unit price 1 | amount 2`).join("\n") });
    const chunks = extractionChunks(parsed);
    expect(chunks.flat().map(source => source.id)).toEqual(parsed.sources.map(source => source.id));
    expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThanOrEqual(3);
  });
  it("does not combine a priced item section with the quotation's commercial summary", async () => {
    const parsed = await parseDocument({ documentId: "mixed-budget", filename: "summary.txt", text: "Inspection | qty 2 hour | unit price 80 | amount 160\nBilling: hourly; scope: visual inspection and report\nCalibration | qty 1 project | unit price 140 | amount 140\nBilling: fixed_project; scope: calibrate two instruments\nSubtotal USD 300\nShipping USD 20\nTax 9%; amount USD 28.80\nQuoted total USD 348.80\nPayment 30 days; valid until 30 September 2026" });
    const chunks = extractionChunks(parsed);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].map(source => source.text).join(" ")).not.toContain("Subtotal");
    expect(chunks[1][0].text).toBe("Subtotal USD 300");
    expect(chunks.flat().map(source => source.id)).toEqual(parsed.sources.map(source => source.id));
  });
  it("preserves real header context without duplicating target coverage or treating separate metadata as many items", async () => {
    const parsed = await parseDocument({ documentId: "context", filename: "quote.txt", text: ["Supplier: Synthetic", "Currency: USD", "All prices tax-exclusive", ...Array.from({ length: 7 }, (_, i) => `Part ${i} 2 each 1.00 2.00`)].join("\n") });
    const chunks = extractionChunks(parsed), context = extractionContext(parsed, chunks[1]);
    expect(chunks).toHaveLength(3); expect(context).toEqual(parsed.sources.slice(0, 3));
    expect(context.every(source => !chunks[1].includes(source))).toBe(true);
    const short = await parseDocument({ documentId: "one-item", filename: "quote.txt", text: "Supplier: Synthetic\nQuote: X1\nCurrency: USD\nItem: A1\nWidget\nQuantity 2\nUnit each\nUnit price 1.00\nLine amount 2.00\nSubtotal 2.00\nTax amount 0\nShipping 0\nPayment 30 days\nLead time 5 business days" });
    expect(extractionChunks(short)).toHaveLength(2); // One item section, then its commercial summary.
  });
  it("uses the nearest same-sheet context instead of a previous sheet's currency", async () => {
    const parsed = await parseDocument({ documentId: "context-sheets", filename: "quote.txt", text: "Currency: USD\nCurrency: EUR\nWidget 2 each 1.00 2.00" });
    parsed.sources = parsed.sources.map((source, index) => ({ ...source, kind: "sheet", sheet: index === 0 ? "Earlier supplier" : "Current quote", cell: `A${index + 1}` }));
    const context = extractionContext(parsed, [parsed.sources[2]]);
    expect(context.map(source => source.text)).toEqual(["Currency: EUR"]);
  });
  it("routes the observed misplaced document terms without asking the model to choose a section", () => {
    const wire = empty();
    wire.fields = [fact("currency", "USD", "s1"), fact("validity", "2026-10-01", "s2"), fact("leadTime", "5 days", "s3"), fact("payment", "30 days", "s4"), fact("taxRate", "9", "s5")];
    const result = expandExtraction(wire, ["s1", "s2", "s3", "s4", "s5"]);
    expect(result.quotation.map(field => field.key)).toEqual(["currency"]);
    expect(result.terms.map(field => field.key)).toEqual(["validity", "leadTime", "payment"]);
    expect(result.attributes[0]).toMatchObject({ key: "taxRate", type: "decimal", sourceIds: ["s5"] });
    expect(extractionSchema.safeParse(result).success).toBe(true);
    wire.fields.push(fact("unitPrice", "1", "s1"));
    expect(() => expandExtraction(wire, ["s1", "s2", "s3", "s4", "s5"])).toThrow(/particular item/);
  });
  it("retains unfamiliar source-linked document facts as text and normalizes only a tax-rate percent suffix", () => {
    const wire = empty(); wire.fields = [fact("taxBasis", "exclusive", "s1"), fact("taxRate", "9%", "s1"), fact("serviceVisits", "every 3 months", "s2")];
    const result = expandExtraction(wire, ["s1", "s2"]);
    expect(result.attributes.map(attribute => [attribute.key, attribute.type, attribute.value, attribute.raw])).toEqual([["taxBasis", "text", "exclusive", "exclusive"], ["taxRate", "decimal", "9", "9%"], ["serviceVisits", "text", "every 3 months", "every 3 months"]]);
    expect(result.quotation).toEqual([]);
  });
  it("derives used coverage and rejects omitted, invented, duplicated or conflicting exclusions", () => {
    const wire = empty(); wire.fields = [fact("name", "Synthetic", "s1")];
    expect(() => expandExtraction(wire, ["s1", "s2"])).toThrow(/omitted/);
    wire.excluded = [{ sourceIds: ["s2"], disposition: "header", reason: "Page label" }];
    expect(expandExtraction(wire, ["s1", "s2"]).coverage.map(source => source.disposition)).toEqual(["used", "header"]);
    for (const ids of [["s1"], ["invented"], ["s2", "s2"]]) { wire.excluded[0].sourceIds = ids; expect(() => expandExtraction(wire, ["s1", "s2"])).toThrow(/coverage/); }
    wire.excluded = []; wire.fields[0].sourceIds = ["secret-other-document"];
    expect(() => expandExtraction(wire, ["s1"])).toThrow(/reference/);
  });
  it("uses a smaller strict wire contract and restores context citations before domain validation", async () => {
    const parsed = await parseDocument({ documentId: "transport-test", filename: "quote.txt", text: "Currency: USD\nWidget qty 2 each unit price 1.25 amount 2.50" });
    const request: AIRequest = { purpose: "extraction", transport: "quotation-v4", schema: strictSchema(extractionSchema), system: extractionInstruction, user: JSON.stringify({ sources: [parsed.sources[1]], context: [parsed.sources[0]] }), maxOutputTokens: 3600 };
    const transport = compactExtractionRequest(request), wire = empty();
    expect(Object.keys(extractionWireSchema.shape.fields.element.shape)).toEqual(["key", "type", "state", "value", "raw", "sourceIds"]);
    expect(JSON.stringify(transport.request.schema).length).toBeLessThan(JSON.stringify(request.schema).length);
    expect(Math.ceil((transport.request.system.length + transport.request.user.length + JSON.stringify(transport.request.schema).length) / 3) + request.maxOutputTokens).toBeLessThanOrEqual(7500);
    wire.items = [{ ...requiredEmpty(), kind: "goods", taxBasis: "not_stated", sourceIds: ["s0"], fields: [], tiers: [], discounts: [] }];
    for (const [key, value] of Object.entries({ description: "Widget", quantity: "2", unit: "each", unitPrice: "1.25", lineAmount: "2.50" })) Object.assign(wire.items[0][key as keyof ReturnType<typeof requiredEmpty>], { state: "value", value, raw: value, sourceIds: ["s0"] });
    wire.items[0].fields = [fact("currency", "USD", "s1")];
    const normalized = transport.restore(wire) as ReturnType<typeof expandExtraction>;
    expect(normalized.items[0].fields.find(field => field.key === "currency")?.sourceIds).toEqual([parsed.sources[0].id]);
    const quote = await extractQuotation(parsed, { request: async () => ({ data: normalized, inputTokens: 0, outputTokens: 0, model: "INJECTED-CONTRACT", elapsedMs: 0, costUsd: null }) });
    expect(quote.items[0].unitPrice.value).toBe("1.25");
    wire.items[0].unitPrice.value = "125";
    await expect(extractQuotation(parsed, { request: async () => ({ data: transport.restore(wire), inputTokens: 0, outputTokens: 0, model: "INJECTED-CONTRACT", elapsedMs: 0, costUsd: null }) })).rejects.toMatchObject({ code: "invalid_evidence" });
  });
  it("prevents context-only items and fieldless anchors from faking completeness", () => {
    const wire = empty(); wire.items = [{ ...requiredEmpty(), kind: "goods", taxBasis: "not_stated", sourceIds: ["context"], fields: [], tiers: [], discounts: [] }];
    expect(() => expandExtraction(wire, ["target"], ["context"])).toThrow(/context row/);
    wire.items[0].sourceIds = ["target"];
    expect(() => expandExtraction(wire, ["target"])).toThrow(/description or identifier/);
  });
});
