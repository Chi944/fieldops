import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractQuotation, extractionChunks } from "@/lib/ai";
import type { AICheckpoint, AIRequest, AIResult } from "@/lib/ai/groq";
import type { ExtractedChunk, ExtractedField } from "@/lib/ai/schema";
import { calculateComparison } from "@/lib/domain/calculate";
import type { Comparison, Quotation } from "@/lib/domain/types";
import { comparisonWorkbook } from "@/lib/export";
import { parseDocument } from "@/lib/processing";
import { ProcessingError } from "@/lib/processing/errors";

const policy = "retain_valid_chunks_v1" as const;
const original = ["Supplier: Pine Tools", ...Array.from({ length: 7 }, (_, n) => `Widget ${n + 1} quantity 2 each unit price 10 amount 20 currency USD tax inclusive`)].join("\n");
const document = (id = "chunk-boundary") => parseDocument({ documentId: id, filename: "synthetic.txt", text: original });
function section(request: AIRequest) { return JSON.parse(request.user) as { section: number; sources: { id: string; text: string }[]; context: { id: string; text: string }[] }; }
const field = <K extends ExtractedField["key"]>(key: K, value: string, sourceId: string): ExtractedField & { key: K } => ({ key, label: key, type: "text", state: "value", value, raw: value, sourceIds: [sourceId], unit: null });
function data(request: AIRequest): ExtractedChunk {
  const body = section(request), sources = [...body.sources, ...body.context], supplier = sources.find(source => source.text === "Supplier: Pine Tools")!;
  return { supplier: [field("name", "Pine Tools", supplier.id)], quotation: [], terms: [], attributes: [], charges: [], uncertainties: [],
    items: body.sources.filter(source => source.text.startsWith("Widget")).map(source => ({ sourceIds: [source.id], kind: "goods", fields: [field("description", source.text.match(/^Widget \d+/)![0], source.id), field("quantity", "2", source.id), field("unit", "each", source.id), field("unitPrice", "10", source.id), field("lineAmount", "20", source.id), field("currency", "USD", source.id)], taxBasis: "inclusive", tiers: [], discount: null, attributes: [] })),
    coverage: sources.map(source => ({ sourceId: source.id, disposition: "used", reason: "Injected synthetic evidence" })),
  };
}
const result = (data: unknown, usageAvailable = true): AIResult => ({ data, model: "INJECTED-NO-PROVIDER", inputTokens: usageAvailable ? 11 : 0, outputTokens: usageAvailable ? 22 : 0, elapsedMs: 3, costUsd: usageAvailable ? "0" : null, usageAvailable });
function cache() {
  const values = new Map<string, AIResult>();
  const checkpoint: AICheckpoint = { get: vi.fn(async key => values.get(key) ?? null), set: vi.fn(async (key, result) => { values.set(key, result); }), reject: vi.fn().mockResolvedValue(undefined) };
  return { checkpoint, values };
}
function compared(quote: Quotation): Comparison {
  const second = structuredClone(quote); second.id = "second-supplier"; second.documentId = "second-supplier"; second.issues = []; second.status = "ready";
  return { id: "comparison", workspaceId: "workspace", name: "Synthetic partial", description: "", revision: 1, isDemo: false, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z", quotations: [quote, second], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" }, groups: [{ id: "widget", label: "Widget", members: [quote, second].map(q => ({ quotationId: q.id, itemId: q.items[0].id })), classification: "equivalent", status: "approved", explanation: "Synthetic comparison", sourceIds: quote.items[0].sourceIds, requiredQuantity: "2", requiredUnit: "each", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: 1 }] };
}
beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("opt-in isolation of rejected interpretation chunks", () => {
  it("retains valid first and final chunks, discards every tentative middle value, and exposes unresolved source evidence", async () => {
    const parsed = await document(), chunks = extractionChunks(parsed), saved = cache();
    expect(chunks).toHaveLength(3);
    const request = vi.fn(async (request: AIRequest) => {
      expect(request.chunkFailurePolicy).toBe(policy);
      const chunk = data(request);
      if (section(request).section === 2) {
        const source = section(request).sources[0];
        chunk.quotation.push(field("quotationNumber", "Widget 4", source.id)); // Written before the invalid item in tentative integration.
        chunk.items[0].fields.find(field => field.key === "unitPrice")!.value = "10 each";
      }
      return result(chunk);
    });
    const quote = await extractQuotation(parsed, { chunkFailurePolicy: policy, request, checkpoint: saved.checkpoint });
    expect(request).toHaveBeenCalledTimes(3); expect(saved.values.size).toBe(2); expect(saved.checkpoint.reject).toHaveBeenCalledOnce();
    expect(quote.items.map(item => item.description.value)).toEqual(["Widget 1", "Widget 2", "Widget 3", "Widget 7"]);
    expect(quote.quotationNumber.state).toBe("not_stated"); expect(quote.quotationNumber.sourceIds).toEqual([]);
    expect(quote.sources).toEqual(parsed.sources); expect(quote.originalText).toBe(parsed.originalText); expect(quote.manifest).toEqual(parsed.manifest);
    expect(quote.status).toBe("partial");
    const rejected = quote.issues.find(issue => issue.message.includes("Section 2 of 3"))!;
    expect(rejected).toMatchObject({ code: "incomplete_extraction", severity: "error", resolved: false, sourceIds: chunks[1].map(source => source.id) });
    expect(rejected.message).toContain("invalid_output"); expect(rejected.message).not.toContain("10 each");
    expect(quote.issues.some(issue => issue.message.includes("Blank fields are unconfirmed"))).toBe(true);
    expect(quote.usage).toMatchObject({ inputTokens: 33, outputTokens: 66, elapsedMs: 9, scope: "accepted_and_rejected_response_metadata", unavailableUsageResponses: 0, acceptedSections: 2, rejectedSections: 1 });
    const comparison = compared(quote), calculation = calculateComparison(comparison);
    expect(calculation.groups[0].lowestQuotationIds).toEqual([]); expect(calculation.groups[0].values[0].status).toBe("needs_review");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await comparisonWorkbook(comparison) as unknown as ExcelJS.Buffer);
    const exportedIssues = workbook.getWorksheet("Review issues")!.getSheetValues().flat().map(String).join("\n");
    expect(exportedIssues).toContain(rejected.message); for (const id of rejected.sourceIds) expect(exportedIssues).toContain(id);
    const exportedSources = workbook.getWorksheet("Sources")!.getSheetValues().flat().map(String).join("\n");
    for (const source of parsed.sources) expect(exportedSources).toContain(source.text);
  });

  it("keeps default rejection behavior and checkpoints only valid chunks for an explicit retry", async () => {
    const parsed = await document(), saved = cache(); let fail = true;
    const request = vi.fn(async (request: AIRequest) => {
      const chunk = data(request); if (fail && section(request).section === 2) chunk.items[0].fields[0].sourceIds = ["another-document:source"];
      return result(chunk);
    });
    await expect(extractQuotation(parsed, { request, checkpoint: saved.checkpoint })).rejects.toMatchObject({ code: "invalid_evidence" });
    expect(request).toHaveBeenCalledTimes(2); expect(saved.values.size).toBe(1);
    expect(request.mock.calls.every(([request]) => request.chunkFailurePolicy === undefined)).toBe(true);
    const partial = await extractQuotation(parsed, { request, checkpoint: saved.checkpoint, chunkFailurePolicy: policy });
    expect(partial.status).toBe("partial"); expect(partial.items).toHaveLength(4); expect(request).toHaveBeenCalledTimes(5);
    fail = false;
    const complete = await extractQuotation(parsed, { request, checkpoint: saved.checkpoint, chunkFailurePolicy: policy });
    expect(complete.items).toHaveLength(7); expect(complete.status).toBe("ready"); expect(request).toHaveBeenCalledTimes(6);
    expect(complete.issues.some(issue => issue.message.includes("rejected"))).toBe(false);
  });

  it("marks missing rejected-response usage unknown instead of reporting accepted tokens as total cost", async () => {
    const quote = await extractQuotation(await document(), { chunkFailurePolicy: policy, request: async request => {
      const chunk = data(request); if (section(request).section === 2) return result({ malformed: true }, false);
      return result(chunk);
    } });
    expect(quote.usage).toMatchObject({ inputTokens: 22, outputTokens: 44, costUsd: null, scope: "accepted_and_rejected_response_metadata", unavailableUsageResponses: 1, acceptedSections: 2, rejectedSections: 1 });
  });

  it.each(["quota", "timeout", "cancelled", "ai_unavailable", "model_error", "limit_exceeded"] as const)("propagates %s without requesting later sections", async code => {
    const failure = new ProcessingError(code, "Synthetic operational failure", true), saved = cache();
    const request = vi.fn(async (request: AIRequest) => { if (section(request).section === 2) throw failure; return result(data(request)); });
    await expect(extractQuotation(await document(), { chunkFailurePolicy: policy, request, checkpoint: saved.checkpoint })).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(2); expect(saved.values.size).toBe(1);
  });

  it.each(["get", "set", "reject"] as const)("propagates %s checkpoint failures even when their error code resembles a validation error", async operation => {
    const saved = cache(), failure = new ProcessingError("invalid_output", "Synthetic storage failure");
    vi.mocked(saved.checkpoint[operation]!).mockRejectedValue(failure);
    const request = vi.fn(async (request: AIRequest) => result(operation === "reject" ? { invalid: true } : data(request)));
    await expect(extractQuotation(await document(), { chunkFailurePolicy: policy, request, checkpoint: saved.checkpoint })).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(operation === "get" ? 0 : 1);
  });

  it("honors cancellation during rejection journaling and does not continue", async () => {
    const controller = new AbortController(), saved = cache();
    vi.mocked(saved.checkpoint.reject!).mockImplementation(async () => { controller.abort(); });
    const request = vi.fn(async () => result({ invalid: true }));
    await expect(extractQuotation(await document(), { chunkFailurePolicy: policy, signal: controller.signal, request, checkpoint: saved.checkpoint })).rejects.toMatchObject({ code: "cancelled" });
    expect(request).toHaveBeenCalledOnce(); expect(saved.values.size).toBe(0);
  });

  it("returns no usable extraction when every planned section is rejected", async () => {
    const saved = cache(), request = vi.fn(async () => result({ invalid: true }));
    await expect(extractQuotation(await document(), { chunkFailurePolicy: policy, request, checkpoint: saved.checkpoint })).rejects.toMatchObject({ code: "invalid_output", message: expect.stringContaining("No quotation section passed validation") });
    expect(request).toHaveBeenCalledTimes(3); expect(saved.values.size).toBe(0); expect(saved.checkpoint.reject).toHaveBeenCalledTimes(3);
  });
});
