import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractQuotation, proposeAIMatches, explainComparison, requestAI, type AICheckpoint, type AIRequest, type AIResult } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import { emptyItem, emptyQuotation, field } from "@/lib/domain/types";

const transport = vi.hoisted(() => vi.fn());
vi.mock("groq-sdk", () => ({ default: class { chat = { completions: { create: transport } }; } }));
const response = (data: unknown): AIResult => ({ data, model: "TEST-INJECTED", inputTokens: 11, outputTokens: 22, costUsd: null, elapsedMs: 3 });
function savedResponses(legacy?: AIResult) {
  const values = new Map<string, AIResult>();
  const rejected = vi.fn<NonNullable<AICheckpoint["reject"]>>().mockResolvedValue();
  const checkpoint: AICheckpoint = {
    get: async key => values.get(key) ?? legacy ?? null,
    set: async (key, value) => { values.set(key, value); legacy = undefined; },
    reject: rejected,
  };
  return { checkpoint, values, rejected };
}
async function document() {
  return parseDocument({ documentId: "checkpoint-synthetic", filename: "synthetic.txt", text: "Acme Supplies\nWidget quantity 2 each unit price 12.50 amount 25.00 currency USD" });
}
function chunk(request: AIRequest) {
  const { sources } = JSON.parse(request.user) as { sources: { id: string; text: string }[] };
  const entry = (key: string, value: string, sourceId = sources[1].id) => ({ key, state: "value", value, raw: value, sourceIds: [sourceId] });
  return { supplier: [entry("name", "Acme Supplies", sources[0].id)], quotation: [], terms: [],
    items: [{ sourceIds: [sources[1].id], kind: "goods", fields: [entry("description", "Widget"), entry("quantity", "2"), entry("unit", "each"), entry("unitPrice", "12.50"), entry("lineAmount", "25.00"), entry("currency", "USD")], taxBasis: "not_stated", tiers: [], discount: null, attributes: [] }],
    charges: [], attributes: [], uncertainties: [], coverage: sources.map(source => ({ sourceId: source.id, disposition: "used", reason: "Synthetic field evidence" })) };
}
beforeEach(() => { transport.mockReset(); vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("validated AI checkpoints with synthetic injected responses", () => {
  it("retains explicit specifications and package wording as text attributes without inventing conversions", async () => {
    const parsed = await parseDocument({ documentId: "package-wording", filename: "quote.txt", text: "Acme Supplies\nWidget quantity 2 each unit price 12.50 amount 25.00 currency USD; stainless steel; assorted pack" });
    const quote = await extractQuotation(parsed, { request: async req => {
      const data = chunk(req);
      data.items[0].fields.push({ key: "specification", state: "value", value: "stainless steel", raw: "stainless steel", sourceIds: [parsed.sources[1].id] }, { key: "packageContents", state: "value", value: "assorted pack", raw: "assorted pack", sourceIds: [parsed.sources[1].id] });
      return response(data);
    } });
    expect(quote.items[0].attributes.map(attribute => [attribute.key, attribute.type, attribute.value.value, attribute.value.sourceIds])).toEqual([
      ["specification", "text", "stainless steel", [parsed.sources[1].id]],
      ["packageContents", "text", "assorted pack", [parsed.sources[1].id]],
    ]);
    expect(quote.items[0].packageSize.state).toBe("not_stated");
  });

  it("rejects invented numeric values and a tax amount relabeled as a rate", async () => {
    const source = await document();
    const request = vi.fn(async (req: AIRequest) => {
      const data = chunk(req); data.items[0].fields.push({ key: "taxRate", state: "value", value: "0", raw: "Widget", sourceIds: [source.sources[1].id] });
      return response(data);
    });
    await expect(extractQuotation(source, { request })).rejects.toMatchObject({ code: "invalid_evidence" });
    const taxSource = await parseDocument({ documentId: "tax-amount-only", filename: "tax.txt", text: "Acme Supplies\nWidget quantity 2 each unit price 12.50 amount 25.00 currency USD tax amount 0" });
    request.mockImplementation(async req => { const data = chunk(req); data.items[0].fields.push({ key: "taxRate", state: "value", value: "0", raw: "tax amount 0", sourceIds: [taxSource.sources[1].id] }); return response(data); });
    await expect(extractQuotation(taxSource, { request })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("retains a shared explicit tax-basis source without misidentifying different rows as duplicates", async () => {
    const parsed = await parseDocument({ documentId: "shared-tax", filename: "tax.txt", text: "Acme Supplies\nWidget quantity 2 each unit price 12.50 amount 25.00 currency USD\nService quantity 2 each unit price 12.50 amount 25.00 currency USD\nAll prices tax-exclusive" });
    const quote = await extractQuotation(parsed, { request: async req => {
      const data = chunk(req); const second = structuredClone(data.items[0]);
      second.fields = second.fields.map(field => ({ ...field, sourceIds: [parsed.sources[2].id], ...(field.key === "description" ? { value: "Service", raw: "Service" } : {}) }));
      second.sourceIds = [parsed.sources[2].id, parsed.sources[3].id]; data.items[0].sourceIds.push(parsed.sources[3].id);
      data.items.push(second); data.items.forEach(item => { item.taxBasis = "exclusive"; });
      return response(data);
    } });
    expect(quote.items).toHaveLength(2); expect(quote.items.every(item => item.sourceIds.includes(parsed.sources[3].id))).toBe(true);
  });

  it("journals provider schema rejections with explicit unavailable usage", async () => {
    vi.stubEnv("FIELDOPS_PROCESSING_MODE", "ai"); vi.stubEnv("GROQ_API_KEY", "TEST-ONLY-NOT-A-REAL-KEY");
    vi.stubEnv("GROQ_FREE_TIER_CONFIRMED", "true"); vi.stubEnv("GROQ_ZDR_CONFIRMED", "true");
    transport.mockRejectedValue({ status: 400, error: { error: { code: "json_validate_failed", failed_generation: "synthetic invalid structure" } } });
    const cache = savedResponses();
    const result = requestAI({ purpose: "extraction", schema: {}, system: "Synthetic", user: "Synthetic", maxOutputTokens: 20 }, { checkpoint: cache.checkpoint });
    await expect(result).rejects.toMatchObject({ code: "invalid_output" });
    expect(cache.rejected).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ data: "synthetic invalid structure", usageAvailable: false, costUsd: null, finishReason: "provider_schema_rejected" }), "invalid_output", { cached: false });
    expect(cache.values.size).toBe(0);
  });

  it("rejects a new invalid schema without caching, then accepts and reuses a successful retry", async () => {
    const source = await document(), cache = savedResponses();
    const request = vi.fn().mockResolvedValueOnce(response({ incomplete: "synthetic invalid schema" })).mockImplementation(async req => response(chunk(req)));
    await expect(extractQuotation(source, { request, checkpoint: cache.checkpoint })).rejects.toMatchObject({ code: "invalid_output" });
    expect(cache.values.size).toBe(0);
    expect(cache.rejected).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ inputTokens: 11, outputTokens: 22 }), "invalid_output", { cached: false });
    expect(request).toHaveBeenCalledTimes(1);
    const quote = await extractQuotation(source, { request, checkpoint: cache.checkpoint });
    expect(quote.items[0].unitPrice.value).toBe("12.50"); expect(cache.values.size).toBe(1);
    await extractQuotation(source, { request, checkpoint: cache.checkpoint });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not let an invalid legacy checkpoint mutate quotation state before a fresh response", async () => {
    const source = await document();
    const bad = chunk({ user: JSON.stringify({ sources: source.sources }) } as AIRequest);
    bad.coverage.pop(); // Rejected only after supplier and item integration has been attempted.
    const cache = savedResponses(response(bad));
    const fresh = { supplier: [], quotation: [], terms: [], items: [], charges: [], attributes: [], uncertainties: [], coverage: source.sources.map(item => ({ sourceId: item.id, disposition: "header", reason: "Synthetic empty response" })) };
    const request = vi.fn().mockResolvedValue(response(fresh));
    const quote = await extractQuotation(source, { request, checkpoint: cache.checkpoint });
    expect(quote.supplier.name.state).toBe("not_stated"); expect(quote.items).toEqual([]);
    expect(request).toHaveBeenCalledOnce();
    expect(cache.rejected).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ data: bad }), "invalid_output", { cached: true });
    expect([...cache.values.values()][0].data).toEqual(fresh);
  });

  it("retains evidence validation failures and retries only the failed response", async () => {
    const source = await document(), cache = savedResponses(); let fail = true;
    const request = vi.fn(async (req: AIRequest) => {
      const data = chunk(req); if (fail) data.items[0].fields[0].sourceIds = ["another-document:private"];
      return response(data);
    });
    await expect(extractQuotation(source, { request, checkpoint: cache.checkpoint })).rejects.toMatchObject({ code: "invalid_evidence" });
    expect(cache.values.size).toBe(0); expect(request).toHaveBeenCalledOnce();
    expect(cache.rejected.mock.calls[0][2]).toBe("invalid_evidence");
    fail = false;
    expect((await extractQuotation(source, { request, checkpoint: cache.checkpoint })).items).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("validates matching membership and explanation references before checkpointing", async () => {
    const quotation = emptyQuotation("synthetic-quote", "synthetic.txt"), item = emptyItem("synthetic-item");
    quotation.sources = [{ id: "source-1", documentId: quotation.id, kind: "text", text: "Widget each" }];
    item.sourceIds = ["source-1"]; item.description = field("Widget", item.sourceIds); item.unit = field("each", item.sourceIds); quotation.items = [item];
    const cache = savedResponses();
    const group = { label: "Widget", members: [{ quotationId: quotation.id, itemId: item.id }], classification: "equivalent", explanation: "Synthetic proposal", sourceIds: ["source-1"] };
    const request = vi.fn().mockResolvedValueOnce(response({ groups: [{ ...group, members: [{ quotationId: quotation.id, itemId: "missing" }] }] })).mockResolvedValue(response({ groups: [group] }));
    await expect(proposeAIMatches([quotation], { request, checkpoint: cache.checkpoint })).rejects.toMatchObject({ code: "invalid_evidence" });
    expect(cache.values.size).toBe(0);
    const groups = await proposeAIMatches([quotation], { request, checkpoint: cache.checkpoint });
    expect(groups).toHaveLength(1); expect(cache.values.size).toBe(1);
    const explain = vi.fn().mockResolvedValueOnce(response({ explanations: [{ kind: "question", text: "Synthetic question", sourceIds: ["foreign"] }] })).mockResolvedValue(response({ explanations: [{ kind: "question", text: "Synthetic question", sourceIds: ["source-1"] }] }));
    await expect(explainComparison([quotation], groups, { request: explain, checkpoint: cache.checkpoint })).rejects.toMatchObject({ code: "invalid_evidence" });
    expect(cache.values.size).toBe(1);
    expect(await explainComparison([quotation], groups, { request: explain, checkpoint: cache.checkpoint })).toHaveLength(1);
    expect(cache.values.size).toBe(2);
  });

  it.each(["length", "invalid-json"])("journals returned usage for %s transport output without exposing content in the error", async failure => {
    vi.stubEnv("FIELDOPS_PROCESSING_MODE", "ai"); vi.stubEnv("GROQ_API_KEY", "TEST-ONLY-NOT-A-REAL-KEY");
    vi.stubEnv("GROQ_FREE_TIER_CONFIRMED", "true"); vi.stubEnv("GROQ_ZDR_CONFIRMED", "true"); vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
    transport.mockResolvedValue({ choices: [{ finish_reason: failure === "length" ? "length" : "stop", message: { content: "synthetic content not for public errors" } }], usage: { prompt_tokens: 17, completion_tokens: 23 } });
    const cache = savedResponses();
    const result = requestAI({ purpose: "extraction", schema: {}, system: "Synthetic test", user: "Synthetic test", maxOutputTokens: 30 }, { checkpoint: cache.checkpoint });
    await expect(result).rejects.toMatchObject({ code: "invalid_output" });
    await expect(result).rejects.not.toHaveProperty("result");
    expect(cache.values.size).toBe(0); expect(transport).toHaveBeenCalledOnce();
    expect(cache.rejected).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ inputTokens: 17, outputTokens: 23, finishReason: failure === "length" ? "length" : "stop" }), "invalid_output", { cached: false });
    expect(vi.mocked(console.info).mock.calls.flat().join(" ")).not.toContain("synthetic content not for public errors");
  });
});
