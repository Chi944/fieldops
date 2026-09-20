import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractQuotation, type AIRequest, type AIResult } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import { calculateComparison } from "@/lib/domain/calculate";
import type { Comparison, Discount, PriceTier } from "@/lib/domain/types";

beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

async function extract(commercial: string, tiers: Omit<PriceTier, "sourceIds">[] = [], discount: Omit<Discount, "sourceIds"> | null = null, priceValue = "10.00") {
  const parsed = await parseDocument({ documentId: "commercial-evidence-synthetic", filename: "self-created.txt", text: `Widget quantity 2 each unit price 10.00 line amount 20.00 currency USD. ${commercial}` });
  return extractQuotation(parsed, { request: async (request: AIRequest): Promise<AIResult> => {
    const source = (JSON.parse(request.user) as { sources: { id: string }[] }).sources[0].id;
    const field = (key: string, value: string, raw = value) => ({ key, label: key, type: "text", state: "value", value, raw, unit: null, sourceIds: [source] });
    return { model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, data: {
      supplier: [], quotation: [field("currency", "USD")], terms: [], attributes: [], charges: [], uncertainties: [],
      items: [{ sourceIds: [source], kind: "goods", fields: [field("description", "Widget"), field("quantity", "2"), field("unit", "each"), field("unitPrice", priceValue, "10.00"), field("lineAmount", "20.00"), field("currency", "USD")], taxBasis: "not_stated", tiers: tiers.map(tier => ({ ...tier, sourceIds: [source] })), discount: discount ? { ...discount, sourceIds: [source] } : null, attributes: [] }],
      coverage: [{ sourceId: source, disposition: "used", reason: "Self-created literal evidence" }],
    } };
  } });
}
const tier = { min: "1", max: "49", unitPrice: "10.00", unit: "each", basis: "all_units" as const };

describe("commercial terms require source-backed numbers and explicit calculation context", () => {
  async function scalar(text: string, key: "currency" | "taxRate", value: string, raw: string) {
    const parsed = await parseDocument({ documentId: "scalar-evidence", filename: "quote.txt", text });
    const source = parsed.sources[0].id;
    const field = { key, label: key, type: "text", state: "value", value, raw, unit: null, sourceIds: [source] };
    return extractQuotation(parsed, { request: async () => ({ model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, data: {
      supplier: [], quotation: key === "currency" ? [field] : [], terms: [], items: [], charges: [], attributes: key === "taxRate" ? [{ ...field, type: "decimal" }] : [], uncertainties: [], coverage: [{ sourceId: source, disposition: "used", reason: "Synthetic source" }],
    } }) });
  }
  it("rejects a different currency code and an ambiguous dollar symbol", async () => {
    await expect(scalar("Currency SGD", "currency", "USD", "SGD")).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(scalar("Price $10", "currency", "USD", "$")).rejects.toMatchObject({ code: "invalid_evidence" });
    expect((await scalar("Currency: Singapore dollars", "currency", "SGD", "Singapore dollars")).currency.value).toBe("SGD");
  });
  it("requires the exact extracted rate to be tied to tax, not to a nearby discount", async () => {
    await expect(scalar("Tax amount 0; discount 5%", "taxRate", "0", "0")).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(scalar("GST 9%; discount 5%", "taxRate", "5", "5%")).rejects.toMatchObject({ code: "invalid_evidence" });
    expect((await scalar("GST 0%; discount 5%", "taxRate", "0", "0%")).attributes[0].value.value).toBe("0");
  });
  it("rejects invented tier bounds and prices despite an existing owned source ID", async () => {
    for (const override of [{ min: "1000" }, { max: "9999" }, { unitPrice: "0.01" }]) {
      await expect(extract("All-unit tiers (each): 1-49 at 10.00.", [{ ...tier, ...override }])).rejects.toMatchObject({ code: "invalid_evidence" });
    }
  });

  it("rejects an invented discount value without accepting a citation as proof", async () => {
    await expect(extract("", [], { kind: "percent", value: "90", basis: "line", alreadyIncluded: false })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("never removes decimal punctuation to invent a larger core value or discount", async () => {
    await expect(extract("", [], null, "1000")).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(extract("Discount: 1.25% on line amount; discount not included in prices.", [], { kind: "percent", value: "125", basis: "line", alreadyIncluded: false })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("preserves decimal-comma prices and range bounds that occur in the original", async () => {
    const tiers = [{ ...tier, max: "499" }, { ...tier, min: "500", max: null, unitPrice: "8.25" }];
    const quote = await extract("All-unit tiers (each): 1-499 at 10,00; 500 and above at 8,25.", tiers);
    expect(quote.items[0].tiers.map(value => ({ ...value, sourceIds: undefined }))).toEqual(tiers.map(value => ({ ...value, sourceIds: undefined })));
    expect(quote.issues.filter(issue => issue.code === "unverified_evidence")).toEqual([]);
  });

  it("preserves regular thousands grouping without confusing it with a decimal fraction", async () => {
    for (const price of ["1,234.50", "1.234,50", "1 234,50"]) {
      const quote = await extract(`All-unit tiers (each): 1-49 at ${price}.`, [{ ...tier, unitPrice: "1234.50" }]);
      expect(quote.items[0].tiers[0].unitPrice).toBe("1234.50");
      expect(quote.issues.filter(issue => issue.code === "unverified_evidence")).toEqual([]);
    }
  });

  it("keeps explicitly stated zero discounts distinct from absent discounts", async () => {
    const quote = await extract("Discount: 0% on line amount; discount not included in unit prices.", [], { kind: "percent", value: "0", basis: "line", alreadyIncluded: false });
    expect(quote.items[0].discount).toMatchObject({ value: "0", alreadyIncluded: false });
    expect(quote.issues.filter(issue => issue.code === "unverified_evidence")).toEqual([]);
  });

  it("retains uncertain tier interpretation for review and excludes it from price recommendations", async () => {
    const quote = await extract("Quantity pricing: 1-49 at 10.00.", [tier]);
    const issue = quote.issues.find(issue => issue.code === "unverified_evidence");
    expect(issue).toMatchObject({ resolved: false, fieldPath: `items.${quote.items[0].id}.tiers`, sourceIds: [quote.sources[0].id] });
    expect(quote.items[0].tiers[0].basis).toBe("all_units");
    const comparison: Comparison = { id: "synthetic-comparison", workspaceId: "synthetic-workspace", name: "Evidence review", description: "", createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z", revision: 0, isDemo: false,
      quotations: [quote], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" },
      groups: [{ id: "group", label: "Widget", classification: "equivalent", status: "approved", explanation: "Synthetic approved match", sourceIds: [quote.sources[0].id], members: [{ quotationId: quote.id, itemId: quote.items[0].id }], requiredQuantity: "2", requiredUnit: "each", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: 0 }] };
    const result = calculateComparison(comparison).groups[0].values[0];
    expect(result.status).toBe("needs_review");
    expect(result.reasons).toContain("Resolve the quotation's outstanding coverage or evidence review before using its prices for a recommendation.");
  });

  it("requires review when a discount's basis, inclusion or kind is unsupported", async () => {
    for (const discount of [
      { kind: "percent" as const, value: "10", basis: "line" as const, alreadyIncluded: false },
      { kind: "percent" as const, value: "10", basis: "unit" as const, alreadyIncluded: true },
      { kind: "fixed" as const, value: "10", basis: "line" as const, alreadyIncluded: false },
    ]) {
      const quote = await extract("Discount: 10%.", [], discount);
      expect(quote.items[0].discount).toMatchObject(discount);
      expect(quote.issues).toContainEqual(expect.objectContaining({ code: "unverified_evidence", resolved: false, fieldPath: `items.${quote.items[0].id}.discount` }));
    }
  });
});
