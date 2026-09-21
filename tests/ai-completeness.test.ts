import { describe, expect, it } from "vitest";
import { extractionCompletenessIssues } from "@/lib/ai/completeness";
import { extractQuotation } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import { absent, emptyItem, emptyQuotation, field, type ParsedDocument } from "@/lib/domain/types";

function quotation(parsed: ParsedDocument) {
  return { ...emptyQuotation(parsed.documentId, parsed.filename), sources: parsed.sources, manifest: parsed.manifest };
}
describe("explicit numeric source details cannot disappear behind a description", () => {
  it("detects the source-backed description-only regression through the real no-provider extraction boundary", async () => {
    const parsed = await parseDocument({ documentId: "explicit-details", filename: "quote.txt", text: "Widget A quantity 2 each unit price 10 line amount 20" });
    const sourceId = parsed.sources[0].id;
    const result = await extractQuotation(parsed, { request: async () => ({ model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, data: {
      supplier: [], quotation: [], terms: [], items: [{ kind: "goods", sourceIds: [sourceId], taxBasis: "not_stated", fields: [{ key: "description", label: "description", type: "text", state: "value", value: "Widget A", raw: "Widget A", unit: null, sourceIds: [sourceId] }], tiers: [], discount: null, attributes: [] }], charges: [], attributes: [], coverage: [{ sourceId, disposition: "used", reason: "Injected description" }], uncertainties: [],
    } }) });
    const issues = extractionCompletenessIssues(result, parsed);
    expect(result.status).toBe("partial");
    expect(result.issues.filter(issue => issue.code === "incomplete_extraction")).toHaveLength(3);
    expect(result.items[0].unitPrice.state).toBe("not_stated");
    expect(issues).toHaveLength(3);
    expect(issues.every(issue => issue.code === "incomplete_extraction" && issue.severity === "error" && !issue.resolved && issue.sourceIds.includes(sourceId))).toBe(true);
  });

  it("accepts properly cited vertical details and flags only the missing explicit amount", async () => {
    const parsed = await parseDocument({ documentId: "vertical-details", filename: "quote.txt", text: "Widget A\nQuantity: 2 each\nUnit price: 10\nLine amount: 20" });
    const quote = quotation(parsed), item = emptyItem("item");
    item.quantity = field("2", [parsed.sources[1].id]); item.unitPrice = field("10", [parsed.sources[2].id]); item.lineAmount = field("20", [parsed.sources[3].id]); quote.items = [item];
    expect(extractionCompletenessIssues(quote, parsed)).toEqual([]);
    item.lineAmount = absent();
    expect(extractionCompletenessIssues(quote, parsed)).toEqual([expect.objectContaining({ sourceIds: [parsed.sources[3].id], message: expect.stringContaining("line amount") })]);
  });

  it("does not require quantity or totals where only an hourly rate is explicitly stated", async () => {
    const parsed = await parseDocument({ documentId: "service-details", filename: "quote.txt", text: "Consulting\nHourly rate: USD 50\nDuration and total to be agreed\nMinimum order quantity: 5\nPackage quantity: 10" });
    const quote = quotation(parsed), item = emptyItem("service"); item.unitPrice = field("50", [parsed.sources[1].id]); quote.items = [item];
    expect(extractionCompletenessIssues(quote, parsed)).toEqual([]);
  });

  it("uses numeric spreadsheet cells and repeated headers without attributing a cell to the wrong field", async () => {
    const parsed = await parseDocument({ documentId: "sheet-details", filename: "quote.csv", bytes: Buffer.from("Description,Quantity,Unit price,Line amount\nWidget A,2,10,20\nDescription,Quantity,Unit price,Line amount\nWidget B,1,0,0\nSubtotal,,,20") });
    const quote = quotation(parsed), first = emptyItem("first"), second = emptyItem("second");
    const id = (cell: string) => parsed.sources.find(source => source.cell === cell)!.id;
    first.quantity = field("2", [id("B2")]); first.unitPrice = field("10", [id("C2")]); first.lineAmount = field("20", [id("D2")]);
    second.quantity = field("1", [id("B4")]); second.lineAmount = field("0", [id("D4")]); quote.items = [first, second];
    expect(extractionCompletenessIssues(quote, parsed)).toEqual([expect.objectContaining({ sourceIds: [id("C4")], message: expect.stringContaining("unit price") })]);
    second.unitPrice = field("0", [id("C4")]); expect(extractionCompletenessIssues(quote, parsed)).toEqual([]);
  });

  it("retains explicit ambiguity and recognized tier/charge interpretation without demanding fabricated item fields", async () => {
    const parsed = await parseDocument({ documentId: "commercial-details", filename: "quote.txt", text: "Quantity 100 unit price 0.50\nSetup quantity 1 each unit price 5 amount 5\nHourly rate: 20" });
    const quote = quotation(parsed), item = emptyItem("item");
    item.tiers = [{ min: "100", max: null, unitPrice: "0.50", unit: "each", basis: "all_units", sourceIds: [parsed.sources[0].id] }];
    item.unitPrice = { ...absent("ambiguous", "20"), sourceIds: [parsed.sources[2].id] }; quote.items = [item];
    quote.charges = [{ id: "setup", kind: "setup", label: "Setup", amount: field("5", [parsed.sources[1].id]), currency: absent(), appliesTo: "quotation" }];
    expect(extractionCompletenessIssues(quote, parsed)).toEqual([]);
  });
});
