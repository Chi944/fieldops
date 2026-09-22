import { describe, expect, it } from "vitest";
import { extractionCompletenessIssues } from "@/lib/ai/completeness";
import { parseDocument } from "@/lib/processing";
import { absent, emptyItem, emptyQuotation, field } from "@/lib/domain/types";

async function quotation(description: string, summaryLabel?: string) {
  const text = `Description,Quantity,Unit price,Line amount\n${description},2,10,20${summaryLabel ? `\n${summaryLabel},,,20` : ""}`;
  const parsed = await parseDocument({ documentId: "summary-synthetic", filename: "summary.csv", bytes: Buffer.from(text) });
  const source = (cell: string) => parsed.sources.find(value => value.cell === cell)!;
  const quote = { ...emptyQuotation(parsed.documentId, parsed.filename), sources: parsed.sources, manifest: parsed.manifest };
  const item = emptyItem("item");
  item.description = field(description, [source("A2").id]);
  quote.items = [item];
  if (summaryLabel) {
    item.quantity = field("2", [source("B2").id]);
    item.unitPrice = field("10", [source("C2").id]);
    item.lineAmount = field("20", [source("D2").id]);
    quote.statedTotal = field("20", [source("D3").id]);
  }
  return { quote, parsed, source };
}

describe("quotation summaries do not become missing item prices", () => {
  it.each(["Total", "Total:"])("accepts a correctly interpreted %s footer beneath the line-amount column", async label => {
    const { quote, parsed, source } = await quotation("Widget", label);
    const before = structuredClone(quote);

    expect(extractionCompletenessIssues(quote, parsed)).toEqual([]);
    expect(quote).toEqual(before);
    expect(quote.statedTotal).toMatchObject({ value: "20", sourceIds: [source("D3").id] });
  });

  it.each(["Total station", "Total"])("still flags omitted numeric details for the priced item named %s", async description => {
    const { quote, parsed, source } = await quotation(description);
    // A model's total classification alone must not hide a priced item row.
    quote.statedTotal = field("20", [source("D2").id]);
    const issues = extractionCompletenessIssues(quote, parsed);

    expect(issues).toHaveLength(3);
    expect(new Set(issues.flatMap(issue => issue.sourceIds))).toEqual(new Set(["B2", "C2", "D2"].map(cell => source(cell).id)));
    expect(issues.every(issue => issue.code === "incomplete_extraction" && issue.severity === "error" && !issue.resolved)).toBe(true);
    expect(quote.items[0].unitPrice.state).toBe("not_stated");
    expect(quote.statedTotal).toMatchObject({ value: "20", sourceIds: [source("D2").id] });
  });

  it("requires retained total evidence from the footer's numeric cell", async () => {
    const { quote, parsed, source } = await quotation("Widget", "Total");
    for (const total of [absent(), field("20", [source("A3").id]), field("20", [source("D2").id])]) {
      quote.statedTotal = total;
      const issues = extractionCompletenessIssues(quote, parsed);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: "incomplete_extraction", sourceIds: [source("D3").id], resolved: false });
    }
  });
});
