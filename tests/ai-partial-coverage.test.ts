import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractQuotation } from "@/lib/ai";
import { compactExtractionRequest, requestAI, type AIRequest, type AIResult } from "@/lib/ai/groq";
import { expandExtraction, extractionWireSchema } from "@/lib/ai/transport";
import { calculateComparison } from "@/lib/domain/calculate";
import type { Comparison, ParsedDocument, Quotation } from "@/lib/domain/types";
import { comparisonWorkbook } from "@/lib/export";
import { parseDocument } from "@/lib/processing";

type Wire = ReturnType<typeof extractionWireSchema.parse>;
const empty = (): Wire => ({ fields: [], items: [], charges: [], excluded: [], uncertainties: [] });
const notStated = () => ({ state: "not_stated" as const, value: null, raw: null, sourceIds: [] as string[] });
const fact = (value: string, id: string) => ({ state: "value" as const, value, raw: value, sourceIds: [id] });
const partialPolicy = { coveragePolicy: "retain_partial" as const };
const row = "Widget | ID W-01 | Qty 2 each | Unit price 10 | Line amount 20 | tax inclusive";
const text = ["Supplier: Pine Tools", "Currency: USD", row, "Number convention: decimal point", "Synthetic supplier notice"].join("\n");
const parsed = (id: string, original = text) => parseDocument({ documentId: id, filename: "synthetic.txt", text: original });
function wireFor(sources: { id: string; text: string }[]): Wire {
  const id = (text: string) => sources.find(source => source.text === text)!.id;
  const line = id(row), data = empty();
  data.fields = [{ key: "name", type: "text", ...fact("Pine Tools", id("Supplier: Pine Tools")) }, { key: "currency", type: "text", ...fact("USD", id("Currency: USD")) }];
  data.items = [{ sourceIds: [line], kind: "goods", description: fact("Widget", line), identifier: fact("W-01", line), quantity: fact("2", line), unit: fact("each", line), unitPrice: fact("10", line), lineAmount: fact("20", line), fields: [], taxBasis: "inclusive", tiers: [], discounts: [] }];
  return data;
}
async function extract(document: ParsedDocument, change: (data: Wire, sources: { id: string; text: string }[]) => void = () => {}) {
  return extractQuotation(document, { request: async request => {
    expect(request.transport).toBe("quotation-v5");
    const transport = compactExtractionRequest(request);
    const sources = (JSON.parse(transport.request.user) as { sources: { id: string; text: string }[] }).sources;
    const data = wireFor(sources); change(data, sources);
    return { data: transport.restore(data), model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null };
  } });
}
const coverageIssues = (quote: Quotation) => quote.issues.filter(issue => issue.code === "incomplete_extraction" && !issue.resolved);
function comparison(quotes: Quotation[]): Comparison {
  return { id: "synthetic-comparison", workspaceId: "synthetic-workspace", name: "Synthetic coverage", description: "", createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z", revision: 1, isDemo: false, quotations: quotes, corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" }, groups: [{ id: "widgets", label: "Widget", members: quotes.map(quote => ({ quotationId: quote.id, itemId: quote.items[0].id })), classification: "equivalent", status: "approved", explanation: "Synthetic approved identical requirement", sourceIds: quotes.flatMap(quote => quote.items[0].sourceIds), requiredQuantity: "2", requiredUnit: "each", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: 1 }] };
}
afterEach(() => vi.restoreAllMocks());

describe("versioned partial recovery of known interpretation coverage", () => {
  it("retains validated fields and every omitted source, blocks ranking, and exports unresolved evidence", async () => {
    const document = await parsed("partial-supplier"), quote = await extract(document);
    expect(quote.status).toBe("partial"); expect(quote.manifest).toEqual(document.manifest); expect(quote.manifest.complete).toBe(true);
    expect(quote.sources).toEqual(document.sources); expect(quote.originalText).toBe(document.originalText);
    expect(quote.items).toHaveLength(1); expect(quote.items[0].unitPrice).toMatchObject({ value: "10", raw: "10", origin: "supplier" });
    const omitted = document.sources.slice(3).map(source => source.id);
    expect(new Set(coverageIssues(quote).flatMap(issue => issue.sourceIds))).toEqual(new Set(omitted));
    expect(coverageIssues(quote).every(issue => issue.message.includes("Interpretation coverage") && !issue.message.includes("unreadable"))).toBe(true);
    expect(new Set(coverageIssues(quote).map(issue => issue.id)).size).toBe(coverageIssues(quote).length);
    const complete = await extract(await parsed("complete-supplier"), (data, sources) => { data.excluded = sources.slice(3).map(source => ({ sourceIds: [source.id], disposition: "header", reason: "Document context" })); });
    expect(complete.status).toBe("ready");
    const compared = comparison([quote, complete]), calculation = calculateComparison(compared);
    expect(calculation.groups[0].lowestQuotationIds).toEqual([]);
    expect(calculation.groups[0].values.find(value => value.quotationId === quote.id)).toMatchObject({ status: "needs_review" });
    expect(calculation.recommendations.some(recommendation => recommendation.kind === "cost")).toBe(false);
    // Establish that coverage, rather than some unrelated item defect, blocks ranking.
    const reviewed = structuredClone(compared); reviewed.quotations[0].issues.forEach(issue => { if (issue.code === "incomplete_extraction") issue.resolved = true; });
    expect(calculateComparison(reviewed).groups[0].lowestQuotationIds).toHaveLength(2);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await comparisonWorkbook(compared) as unknown as ExcelJS.Buffer);
    const issueRows = workbook.getWorksheet("Review issues")!.getSheetValues().flat().map(String).join("\n");
    for (const issue of coverageIssues(quote)) { expect(issueRows).toContain(issue.message); for (const sourceId of issue.sourceIds) expect(issueRows).toContain(sourceId); }
    const sourceRows = workbook.getWorksheet("Sources")!.getSheetValues().flat().map(String).join("\n");
    for (const source of document.sources) expect(sourceRows).toContain(source.text);
  });

  it("keeps an omitted priced row partial without synthesizing a replacement item", async () => {
    const document = await parsed("omitted-price", `${text}\nCable quantity 2 each unit price 5 line amount 10`);
    const quote = await extract(document);
    expect(quote.items).toHaveLength(1); expect(quote.status).toBe("partial");
    expect(coverageIssues(quote).some(issue => issue.sourceIds.includes(document.sources.at(-1)!.id))).toBe(true);
    expect(quote.sources.at(-1)!.text).toContain("Cable");
  });

  it.each(["used", "duplicate", "context"] as const)("preserves a known %s exclusion conflict as source-linked uninterpreted coverage", kind => {
    const data = empty(); data.fields.push({ key: "name", type: "text", ...fact("Pine Tools", "target") });
    const id = kind === "context" ? "context" : kind === "duplicate" ? "footer" : "target";
    data.excluded = [{ sourceIds: [id], disposition: "header", reason: "First model annotation" }];
    if (kind === "duplicate") data.excluded.push({ sourceIds: [id], disposition: "non_quotation", reason: "Second model annotation" });
    const result = expandExtraction(data, ["target", "footer"], ["context"], partialPolicy);
    expect(result.supplier[0].value).toBe("Pine Tools"); expect(result.items).toEqual([]);
    const conflict = result.coverage.find(coverage => coverage.sourceId === id)!;
    expect(conflict.disposition).toBe("uninterpreted"); expect(conflict.reason).toContain("First model annotation");
    if (kind === "duplicate") expect(conflict.reason).toContain("Second model annotation");
    expect(new Set(result.coverage.map(coverage => coverage.sourceId))).toEqual(new Set(["target", "footer", "context"]));
    expect(result.coverage).toHaveLength(3);
  });

  it("retains strict legacy omissions and conflicts instead of silently reinterpreting old responses", () => {
    expect(() => expandExtraction(empty(), ["target"])).toThrow(/omitted/);
    const data = empty(); data.fields.push({ key: "name", type: "text", ...fact("Pine Tools", "target") });
    data.excluded = [{ sourceIds: ["target"], disposition: "header", reason: "Conflicting model annotation" }];
    expect(() => expandExtraction(data, ["target"])).toThrow(/coverage/);
    const legacy = compactExtractionRequest({ purpose: "extraction", transport: "quotation-v4", schema: {}, system: "Unchanged", user: JSON.stringify({ sources: [{ id: "target", text: "Pine Tools" }] }), maxOutputTokens: 20 });
    expect(() => legacy.restore(empty())).toThrow(/omitted/);
  });

  it("still rejects unknown exclusions and foreign or repeated field references", () => {
    const excluded = empty(); excluded.excluded.push({ sourceIds: ["another-document:source"], disposition: "header", reason: "Wrong document" });
    expect(() => expandExtraction(excluded, ["target"], [], partialPolicy)).toThrow(/reference/);
    for (const ids of [["another-document:source"], ["target", "target"]]) {
      const data = empty(); data.fields.push({ key: "name", type: "text", ...fact("Pine Tools", "target"), sourceIds: ids });
      expect(() => expandExtraction(data, ["target"], [], partialPolicy)).toThrow(/reference/);
    }
  });

  it.each([
    { name: "non-null missing value", field: { ...notStated(), value: "10" } },
    { name: "missing value with cited text", field: { ...notStated(), raw: "10", sourceIds: ["target"] } },
    { name: "null stated value", field: { ...fact("10", "target"), value: null } },
  ])("rejects $name before an absent core field can be discarded", ({ field }) => {
    const data = wireFor([{ id: "supplier", text: "Supplier: Pine Tools" }, { id: "currency", text: "Currency: USD" }, { id: "target", text: row }]);
    data.items[0].unitPrice = field;
    expect(() => expandExtraction(data, ["supplier", "currency", "target"], [], partialPolicy)).toThrow(/state/);
  });

  it.each(["raw", "numeric", "currency"] as const)("does not relax %s evidence for an otherwise recoverable coverage gap", async failure => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(extract(await parsed(`invalid-${failure}`), data => {
      if (failure === "raw") data.items[0].identifier.raw = "ID W-01 invented prefix";
      if (failure === "numeric") data.items[0].quantity.value = "200";
      if (failure === "currency") data.fields.find(field => field.key === "currency")!.value = "SGD";
    })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("uses a distinct checkpoint identity while keeping identical prompt wording", async () => {
    const cache = new Map<string, AIResult>();
    const checkpoint = { get: vi.fn(async (key: string) => cache.get(key) ?? null), set: vi.fn(async (key: string, value: AIResult) => { cache.set(key, value); }) };
    const request = vi.fn(async (input: AIRequest): Promise<AIResult> => ({ data: compactExtractionRequest(input).restore({ ...empty(), excluded: [{ sourceIds: ["s0"], disposition: "header", reason: "Document context" }] }), model: "INJECTED", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null }));
    const base: AIRequest = { purpose: "extraction", transport: "quotation-v4", schema: {}, system: "Exactly the same prompt", user: JSON.stringify({ sources: [{ id: "target", text: "Document context" }] }), maxOutputTokens: 20 };
    for (const transport of ["quotation-v4", "quotation-v5", "quotation-v5"] as const) await requestAI({ ...base, transport }, { request, checkpoint }, result => result);
    expect(request).toHaveBeenCalledTimes(2); expect(cache.size).toBe(2);
    expect(request.mock.calls.map(([input]) => input.system)).toEqual([base.system, base.system]);
  });
});
