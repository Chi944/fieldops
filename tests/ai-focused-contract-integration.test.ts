import { afterEach, describe, expect, it, vi } from "vitest";
import { extractQuotation } from "@/lib/ai";
import { aiRequestKey, compactExtractionRequest, type AIRequest } from "@/lib/ai/groq";
import { sectionFieldKeys } from "@/lib/ai/schema";
import { calculateComparison, calculateItem } from "@/lib/domain/calculate";
import type { Comparison } from "@/lib/domain/types";
import { parseDocument } from "@/lib/processing";

const absent = () => ({ state: "not_stated" as const, value: null, raw: null, sourceIds: [] as string[] });
const fact = (value: string, id: string, raw = value) => ({ state: "value" as const, value, raw, sourceIds: [id] });
const service = "1. Inspection | ID IN-9 | Qty 2 hour | Unit price 25 | Line amount 50 | tax inclusive";
const basis = "Billing basis: per hour";
const scope = "Scope: Inspect equipment";
const minimum = "Minimum order: 6 hours";
const goods = "2. Bearing | ID BE-2 | Qty 3 each | Unit price 4 | Line amount 12 | tax inclusive";
type Source = { id: string; text: string; slot?: string };

async function run(change?: "missing_billing" | "invented_minimum" | "unit_as_billing") {
  const parsed = await parseDocument({ documentId: "new-contract-integration", filename: "synthetic.txt", text: ["Supplier: Cedar Review", "Currency: USD", service, ...(change === "unit_as_billing" ? [] : [basis]), scope, minimum, goods].join("\n") });
  const requests: AIRequest[] = [];
  const quotation = await extractQuotation(parsed, { extractionTransport: "focused_fields_v2", chunkFailurePolicy: "retain_valid_chunks_v1", request: async request => {
    requests.push(request);
    const wire = compactExtractionRequest(request);
    const body = JSON.parse(wire.request.user) as { task: "items" | "document"; sources: Source[]; context: Source[] };
    const all = [...body.sources, ...body.context], id = (text: string) => all.find(source => source.text === text)!.id;
    const currency = fact("USD", id("Currency: USD"));
    let response: unknown;
    if (body.task === "document") {
      response = { supplier: { ...Object.fromEntries(sectionFieldKeys.supplier.map(key => [key, absent()])), name: fact("Cedar Review", id("Supplier: Cedar Review")) },
        quotation: { ...Object.fromEntries(sectionFieldKeys.quotation.map(key => [key, absent()])), currency },
        terms: Object.fromEntries(sectionFieldKeys.terms.map(key => [key, absent()])), charges: [], attributes: [], uncertainties: [] };
    } else {
      response = { items: Object.fromEntries(body.sources.filter(source => [service, goods].includes(source.text)).map(source => {
        const isService = source.text === service;
        return [source.slot!, { ...Object.fromEntries(sectionFieldKeys.item.map(key => [key, absent()])),
          description: fact(isService ? "Inspection" : "Bearing", source.id), identifier: fact(isService ? "IN-9" : "BE-2", source.id), quantity: fact(isService ? "2" : "3", source.id),
          unit: fact(isService ? "hour" : "each", source.id), unitPrice: fact(isService ? "25" : "4", source.id), lineAmount: fact(isService ? "50" : "12", source.id), currency,
          billingBasis: isService && change !== "missing_billing" ? change === "unit_as_billing" ? fact("per hour", source.id, "hour") : fact("per hour", id(basis)) : absent(),
          scope: isService ? fact("Inspect equipment", id(scope)) : absent(), minimumOrder: isService ? fact(change === "invented_minimum" ? "6000" : "6", id(minimum), "6 hours") : absent(),
          kind: isService ? "service" : "goods", taxBasis: "inclusive", attributes: [], tiers: [], discounts: [] }];
      })), uncertainties: [] };
    }
    return { data: wire.restore(response), model: "INJECTED-NO-MODEL-CALL", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
  } });
  return { quotation, parsed, requests };
}
afterEach(() => vi.restoreAllMocks());

describe("typed focused extraction integration", () => {
  it("preserves evidence through planning, compaction, typed decoding and domain integration", async () => {
    const { quotation, parsed, requests } = await run();
    expect(requests.map(request => JSON.parse(request.user).task)).toEqual(["items", "document"]);
    expect(requests.every(request => request.transport === "quotation-v10")).toBe(true);
    expect(quotation.status).toBe("ready");
    expect(quotation.sources).toEqual(parsed.sources);
    expect(quotation.items).toHaveLength(2);
    expect(quotation.items[0].billingBasis).toMatchObject({ value: "per hour", raw: "per hour", sourceIds: [parsed.sources.find(source => source.text === basis)!.id], origin: "supplier" });
    expect(quotation.items[0].minimumOrder).toMatchObject({ value: "6", raw: "6 hours", sourceIds: [parsed.sources.find(source => source.text === minimum)!.id] });
    expect(quotation.items[1].unitPrice).toMatchObject({ value: "4", raw: "4" });
    expect(quotation.issues.some(issue => issue.fieldPath?.endsWith(".billingBasis"))).toBe(false);
    expect(aiRequestKey(requests[0])).not.toBe(aiRequestKey({ ...requests[0], transport: "quotation-v9" }));
  });

  it("keeps an explicitly absent billing field missing and visible instead of inferring it", async () => {
    const { quotation, parsed } = await run("missing_billing");
    expect(quotation.sources).toEqual(parsed.sources);
    expect(quotation.items[0].billingBasis).toMatchObject({ state: "not_stated", value: null, sourceIds: [] });
    expect(quotation.issues).toContainEqual(expect.objectContaining({ code: "missing_field", fieldPath: `items.${quotation.items[0].id}.billingBasis`, resolved: false }));
    expect(calculateItem(quotation.items[0]).amount).toBeNull();
  });

  it("rejects an unsupported numeric reinterpretation without salvaging that response's rows", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { quotation, parsed } = await run("invented_minimum");
    expect(quotation.status).toBe("partial");
    expect(quotation.items).toHaveLength(0);
    expect(quotation.supplier.name.value).toBe("Cedar Review");
    expect(quotation.sources).toEqual(parsed.sources);
    expect(quotation.usage).toMatchObject({ acceptedSections: 1, rejectedSections: 1 });
    expect(quotation.issues.some(issue => issue.code === "incomplete_extraction" && issue.sourceIds.includes(parsed.sources.find(source => source.text === minimum)!.id))).toBe(true);
  });

  it("retains a unit-only billing assertion but flags its evidence before comparison", async () => {
    const { quotation, parsed } = await run("unit_as_billing");
    expect(quotation.sources).toEqual(parsed.sources);
    expect(quotation.items[0].billingBasis).toMatchObject({ state: "value", value: "per hour", raw: "hour", sourceIds: [parsed.sources.find(source => source.text === service)!.id] });
    expect(quotation.issues).toContainEqual(expect.objectContaining({ code: "unverified_evidence", fieldPath: `items.${quotation.items[0].id}.billingBasis`, resolved: false }));
    expect(quotation.issues.filter(issue => issue.code === "incomplete_extraction")).toEqual([]);
    const comparison: Comparison = { id: "guard-probe", workspaceId: "test", name: "Guard probe", description: "", createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z", revision: 1, isDemo: false,
      quotations: [quotation], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" }, groups: [{ id: "g", label: "Inspection", members: [{ quotationId: quotation.id, itemId: quotation.items[0].id }], classification: "equivalent", status: "approved", explanation: "Buyer grouping", sourceIds: quotation.items[0].sourceIds, requiredQuantity: "6", requiredUnit: "hour", acceptedOrderQuantities: { [quotation.id]: "6" }, billingPeriods: null, requirements: "", approvedRevision: 1 }] };
    const result = calculateComparison(comparison);
    expect(result.groups[0].values[0]).toMatchObject({ status: "needs_review", amount: "150.00" });
    expect(result.recommendations.filter(recommendation => recommendation.kind === "cost")).toEqual([]);
    // Isolate the evidence guard from other constraints such as MOQ or missing items.
    const withoutGuard = structuredClone(comparison); withoutGuard.quotations[0].issues = [];
    expect(calculateComparison(withoutGuard).groups[0].values[0]).toMatchObject({ status: "eligible", amount: "150.00" });
  });
});
