import { describe, expect, it } from "vitest";
import { compactExtractionRequest, extractQuotation, type AIRequest, type AIResult } from "../src/lib/ai";
import { parseDocument } from "../src/lib/processing";

const csv = "Supplier,Acme,,,,\nCurrency,USD,,,,\nDescription,Identifier,Quantity,Unit,Unit price,Line amount\nWidget,W-1,2,each,10,20";
function response(request: AIRequest, mutate?: (data: ReturnType<typeof wireData>) => void): AIResult {
  expect(["quotation-v6", "quotation-v7"]).toContain(request.transport);
  const wire = compactExtractionRequest(request);
  expect(JSON.stringify(wire.request.schema)).toContain("$ref");
  const data = wireData(JSON.parse(wire.request.user).sources);
  mutate?.(data);
  const partition = (fields: typeof data.quotation) => ({ numeric: fields.filter(field => ["quantity", "unitPrice", "lineAmount"].includes(field.key)), text: fields.filter(field => !["quantity", "unitPrice", "lineAmount"].includes(field.key)) });
  const payload = request.transport === "quotation-v7" ? { ...data, quotation: partition(data.quotation), attributes: { decimal: [], text: [] }, items: data.items.map(item => ({ ...item, fields: partition(item.fields), attributes: { decimal: [], text: [] } })) } : data;
  return { data: wire.restore(payload), model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
}
function wireData(sources: { id: string; cell: string }[]) {
  const id = (cell: string) => sources.find(source => source.cell === cell)!.id;
  const field = (key: string, value: string, cell: string) => ({ key, value, state: "value", raw: value, sourceIds: [id(cell)] });
  const used = ["B1", "B2", "A4", "B4", "C4", "D4", "E4", "F4"].map(id);
  return { supplier: [field("name", "Acme", "B1")], quotation: [field("currency", "USD", "B2")], terms: [], attributes: [], charges: [], uncertainties: [],
    items: [{ kind: "goods", sourceIds: [id("A4")], fields: [field("description", "Widget", "A4"), field("identifier", "W-1", "B4"), field("quantity", "2", "C4"), field("unit", "each", "D4"), field("unitPrice", "10", "E4"), field("lineAmount", "20", "F4")], attributes: [], taxBasis: "not_stated", tiers: [], discounts: [] }],
    excluded: [{ sourceIds: sources.map(source => source.id).filter(id => !used.includes(id)), disposition: "header", reason: "Literal row and column labels" }] };
}
async function document() { return parseDocument({ documentId: "typed-boundary", filename: "quotation.csv", bytes: Buffer.from(csv) }); }

describe.each(["typed_fields_v1", "typed_fields_v2"] as const)("%s source evidence through wire restoration and domain integration", extractionTransport => {
  it("preserves valid decimal strings, cell evidence and original sources", async () => {
    const parsed = await document();
    const quote = await extractQuotation(parsed, { extractionTransport, request: async request => response(request) });
    expect(quote.status).toBe("ready"); expect(quote.items[0].unitPrice.value).toBe("10");
    expect(quote.items[0].identifier.raw).toBe("W-1"); expect(quote.sources).toEqual(parsed.sources);
  });
  it("continues to reject invented excerpts rather than replacing them with broader cell text", async () => {
    await expect(extractQuotation(await document(), { extractionTransport, request: async request => response(request, data => { data.items[0].fields[1].raw = "ID W-1"; }) })).rejects.toMatchObject({ code: "invalid_evidence" });
  });
  it("retains service scope in its item core field rather than quotation-wide terms", async () => {
    const scoped = "Supplier,Acme,,,,,\nCurrency,USD,,,,,\nDescription,Identifier,Quantity,Unit,Unit price,Line amount,Scope\nWidget,W-1,2,each,10,20,Installation only";
    const parsed = await parseDocument({ documentId: "typed-scope", filename: "quote.csv", bytes: Buffer.from(scoped) });
    const quote = await extractQuotation(parsed, { extractionTransport, request: async request => response(request, data => {
      const sources = JSON.parse(compactExtractionRequest(request).request.user).sources as { id: string; cell: string }[];
      const sourceId = sources.find(source => source.cell === "G4")!.id;
      data.items[0].kind = "service";
      data.items[0].fields.push({ key: "scope", state: "value", value: "Installation only", raw: "Installation only", sourceIds: [sourceId] });
      data.excluded[0].sourceIds = data.excluded[0].sourceIds.filter(id => id !== sourceId);
    }) });
    expect(quote.items[0].scope.value).toBe("Installation only");
    expect(quote.items[0].attributes.some(attribute => attribute.key === "scope")).toBe(false);
    expect(quote.terms.exclusions.state).toBe("not_stated");
  });
  it("rejects unit text in decimal fields before it can reach arithmetic", async () => {
    await expect(extractQuotation(await document(), { extractionTransport, request: async request => response(request, data => { data.items[0].fields[2].value = "2 each"; }) })).rejects.toMatchObject({ code: "invalid_output" });
  });
  it("flags swapped quantity/price cell roles even when the row arithmetic still balances", async () => {
    const quote = await extractQuotation(await document(), { extractionTransport, request: async request => response(request, data => {
      const fields = data.items[0].fields;
      const quantity = fields[2], price = fields[4];
      fields[2] = { ...price, key: "quantity" }; fields[4] = { ...quantity, key: "unitPrice" };
    }) });
    expect(quote.status).toBe("partial");
    expect(quote.issues.filter(issue => issue.code === "incomplete_extraction")).toHaveLength(2);
  });
});
