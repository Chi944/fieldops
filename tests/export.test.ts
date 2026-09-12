import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { comparisonWorkbook } from "../src/lib/export";
import { demoComparisons } from "../src/lib/demo";
import { applyCorrection } from "../src/lib/domain/corrections";
import { absent, field } from "../src/lib/domain/types";

async function load(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook;
}
function records(workbook: ExcelJS.Workbook, sheetName: string): Record<string, ExcelJS.CellValue>[] {
  const sheet = workbook.getWorksheet(sheetName)!;
  expect(sheet, `Missing worksheet: ${sheetName}`).toBeDefined();
  const headers = sheet.getRow(1).values as string[];
  const rows: Record<string, ExcelJS.CellValue>[] = [];
  sheet.eachRow((row, i) => { if (i > 1) rows.push(Object.fromEntries(headers.slice(1).map((header, j) => [header, row.getCell(j + 1).value]))); });
  return rows;
}

describe("decision workbook round trip", () => {
  it("exports a pinned snapshot with source index, unresolved issues, explicit assumptions and no input mutation", async () => {
    const comparison = demoComparisons()[0];
    const before = structuredClone(comparison);
    const prepared = "2026-09-13T01:02:03.000Z";
    const workbook = await load(await comparisonWorkbook(comparison, { calculatedAt: prepared }));
    expect(comparison).toEqual(before);
    const summary = Object.fromEntries(records(workbook, "Summary").map(row => [String(row.Field), row.Value]));
    expect(summary["Comparison date"]).toBe(prepared);
    expect(summary["Snapshot revision"]).toBe(comparison.revision);
    expect(summary["Unresolved issues"]).toBe(comparison.quotations.flatMap(q => q.issues).filter(i => !i.resolved).length);
    expect(summary.Mode).toContain("Demonstration");
    expect(summary.Assumptions).toContain("Unknown costs are not zero");
    expect(workbook.created.toISOString()).toBe(prepared);
    const sources = records(workbook, "Sources");
    const originalSources = comparison.quotations.flatMap(q => q.sources);
    expect(sources).toHaveLength(originalSources.length);
    expect(new Set(sources.map(row => row["Source ID"])).size).toBe(originalSources.length);
    for (const source of originalSources) {
      const exported = sources.find(row => row["Source ID"] === source.id)!;
      expect(exported.Excerpt).toBe(source.text);
      expect(exported.Location).toBe(`Characters ${source.start}–${source.end}`);
    }
    for (const row of records(workbook, "Reviewed items")) {
      for (const id of String(row["Source IDs"]).split(", ").filter(Boolean)) expect(sources.some(source => source["Source ID"] === id)).toBe(true);
    }
    const issues = records(workbook, "Review issues");
    expect(issues).toHaveLength(comparison.quotations.flatMap(q => q.issues).length);
    expect(issues.some(row => String(row.Issue).includes("Delivery cost is not stated"))).toBe(true);
    expect(records(workbook, "Supplier totals").every(row => String(row.Label).includes("incomplete cost"))).toBe(true);
  });

  it("preserves earliest supplier values and every successive user correction", async () => {
    let comparison = demoComparisons()[0];
    const originalQuote = comparison.quotations[0];
    for (const price of ["184.50", "183.00"]) comparison = applyCorrection(comparison, {
      quotationId: originalQuote.id, path: `items.${originalQuote.items[0].id}.unitPrice`, value: price,
      reason: `Rechecked price ${price}`, author: "Test reviewer", baseVersion: comparison.revision,
    });
    const workbook = await load(await comparisonWorkbook(comparison));
    const original = records(workbook, "Original items").find(row => row.Supplier === "Northstar Studio Supply" && row.Description === "Ergonomic studio chair")!;
    const reviewed = records(workbook, "Reviewed items").find(row => row.Supplier === "Northstar Studio Supply" && row.Item === "Ergonomic studio chair")!;
    expect(original["Unit price"]).toBe("185");
    expect(reviewed["Unit price"]).toBe("183.00");
    expect(reviewed["Stated line amount"]).toBe("740.00");
    const corrections = records(workbook, "Corrections");
    expect(corrections.map(row => [row.Original, row.Correction])).toEqual([["185", "184.50"], ["184.50", "183.00"]]);
    expect(corrections.every(row => row.Author === "Test reviewer" && row.Reason && row.Date)).toBe(true);
    expect(records(workbook, "Assumptions").some(row => String(row.Details).includes("stale"))).toBe(true);
  });

  it("writes formula-like untrusted supplier strings literally, preserving zero and missing states", async () => {
    const comparison = demoComparisons()[0];
    const quotation = comparison.quotations[0];
    const supplier = '=HYPERLINK("https://example.invalid/", "untrusted")';
    quotation.supplier.name = field(supplier, quotation.supplier.name.sourceIds);
    quotation.items[0].description = field("+1+2", quotation.items[0].sourceIds);
    quotation.terms.payment = absent();
    quotation.terms.warranty = absent("not_applicable");
    quotation.terms.delivery = absent("ambiguous", "Delivery may be included");
    quotation.charges[0].amount = field("0", quotation.charges[0].amount.sourceIds);
    const workbook = await load(await comparisonWorkbook(comparison));
    for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)));
    const reviewed = records(workbook, "Reviewed items")[0];
    expect(reviewed.Supplier).toBe(supplier);
    expect(reviewed.Item).toBe("+1+2");
    const terms = records(workbook, "Commercial terms").filter(row => row.Supplier === supplier);
    expect(terms.find(row => row.Term === "payment")).toMatchObject({ Value: "Not stated", State: "not_stated" });
    expect(terms.find(row => row.Term === "warranty")).toMatchObject({ State: "not_applicable" });
    expect(terms.find(row => row.Term === "delivery")).toMatchObject({ State: "ambiguous" });
    const charges = records(workbook, "Charges and price rules");
    expect(charges.find(row => row.Document === quotation.filename && row.Type === "shipping")?.Terms).toContain("0 SGD");
    expect(charges.find(row => row.Document === comparison.quotations[1].filename && row.Type === "shipping")?.Terms).toContain("not_stated");
  });

  it("retains sheet/page locators, private original links, package tiers, attributes and user-supplied FX context", async () => {
    const comparison = demoComparisons()[0];
    comparison.quotations[0].isDemo = false;
    comparison.quotations[0].sources[0] = { id: comparison.quotations[0].sources[0].id, documentId: comparison.quotations[0].documentId, kind: "sheet", sheet: "Quoted items", cell: "B7", text: "Northstar Studio Supply" };
    comparison.quotations[0].sources[1] = { id: comparison.quotations[0].sources[1].id, documentId: comparison.quotations[0].documentId, kind: "pdf_text", page: 2, text: "Ergonomic studio chair" };
    comparison.exchangeRates.push({ id: "fx-test", from: "SGD", to: "USD", rate: "0.75", date: "2026-09-12", source: "User treasury sheet" });
    const workbook = await load(await comparisonWorkbook(comparison, { sourceOrigin: "https://fieldops.example" }));
    const sources = records(workbook, "Sources");
    expect(sources[0]).toMatchObject({ Location: "Quoted items!B7", Original: "https://fieldops.example/api/documents/northstar/source" });
    expect(sources[1].Location).toBe("Page 2");
    const rules = records(workbook, "Charges and price rules");
    expect(rules.some(row => row.Type === "Packaging / MOQ" && String(row.Terms).includes("6 each per pack"))).toBe(true);
    expect(rules.some(row => row.Type === "Quantity tier" && String(row.Terms).includes("41, all_units"))).toBe(true);
    expect(records(workbook, "Additional attributes").some(row => String(row.Value).includes("CRI 90"))).toBe(true);
    expect(records(workbook, "Assumptions").find(row => row.Type === "User-supplied FX")?.Details).toBe("1 SGD = 0.75 USD; 2026-09-12; User treasury sheet");
  });
});
