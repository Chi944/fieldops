import { afterEach, describe, expect, it, vi } from "vitest";
import { extractQuotation } from "../src/lib/ai";
import { compactExtractionRequest } from "../src/lib/ai/groq";
import { sectionFieldKeys } from "../src/lib/ai/schema";
import { parseDocument } from "../src/lib/processing";
import type { Quotation } from "../src/lib/domain/types";

const absent = () => ({ state: "not_stated" as const, value: null, raw: null, sourceIds: [] as string[] });
const fact = (value: string, id: string) => ({ state: "value" as const, value, raw: value, sourceIds: [id] });
const row = "1. Widget | ID W-01 | Qty 2 each | Unit price 10 | Line amount 20 | tax inclusive";
type RecordSource = { id: string; text: string; slot?: string };
const coverage = (quotation: Quotation) => quotation.issues.filter(issue => issue.code === "incomplete_extraction");
async function run(extra: { before?: string; continuation?: string; charge?: boolean; badPrice?: boolean } = {}) {
  const parsed = await parseDocument({ documentId: "focused-integration", filename: "synthetic.txt", text: ["Supplier: Pine Tools", "Currency: USD", extra.before, row, extra.continuation,
    ...(extra.charge ? ["Shipping: USD 5 for item W-01"] : [])].filter(Boolean).join("\n") });
  const tasks: string[] = [];
  const quotation = await extractQuotation(parsed, { extractionTransport: "focused_fields_v1", request: async request => {
    expect(request.transport).toBe("quotation-v9");
    const wire = compactExtractionRequest(request);
    const body = JSON.parse(wire.request.user) as { task: string; sources: RecordSource[]; context: RecordSource[] };
    tasks.push(body.task);
    const all = [...body.sources, ...body.context], find = (text: string) => all.find(source => source.text === text)!.id;
    let response: unknown;
    if (body.task === "items") {
      const source = body.sources.find(source => source.text === row)!;
      response = { items: { [source.slot!]: { description: fact("Widget", source.id), identifier: fact("W-01", source.id), quantity: fact("2", source.id), unit: fact("each", source.id),
        unitPrice: { ...fact("10", source.id), value: extra.badPrice ? "100" : "10" }, lineAmount: fact("20", source.id), currency: fact("USD", find("Currency: USD")),
        fields: [], attributes: [], kind: "goods", taxBasis: "inclusive", tiers: [], discounts: [] } }, uncertainties: [] };
    } else {
      response = { supplier: { ...Object.fromEntries(sectionFieldKeys.supplier.map(key => [key, absent()])), name: fact("Pine Tools", find("Supplier: Pine Tools")) },
        quotation: { ...Object.fromEntries(sectionFieldKeys.quotation.map(key => [key, absent()])), currency: fact("USD", find("Currency: USD")) },
        terms: Object.fromEntries(sectionFieldKeys.terms.map(key => [key, absent()])),
        charges: extra.charge ? [{ label: fact("Shipping", find("Shipping: USD 5 for item W-01")), kind: { ...fact("Shipping", find("Shipping: USD 5 for item W-01")), value: "shipping" }, amount: fact("5", find("Shipping: USD 5 for item W-01")), currency: fact("USD", find("Shipping: USD 5 for item W-01")), attributes: [], billingPeriod: absent(), appliesTo: fact("item", find("Shipping: USD 5 for item W-01")), itemSourceId: find(row) }] : [],
        attributes: [], uncertainties: [] };
    }
    return { data: wire.restore(response), model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false };
  } });
  return { quotation, parsed, tasks };
}
afterEach(() => vi.restoreAllMocks());

describe("focused extraction through source compaction and domain integration", () => {
  it("extracts items before document details and does not misclassify the same priced context as an omitted row", async () => {
    const { quotation, parsed, tasks } = await run();
    expect(tasks).toEqual(["items", "document"]);
    expect(quotation.status).toBe("ready");
    expect(coverage(quotation)).toEqual([]);
    expect(quotation.sources).toEqual(parsed.sources);
    expect(quotation.items[0]).toMatchObject({ identifier: { value: "W-01" }, quantity: { value: "2" }, unitPrice: { value: "10", raw: "10" } });
    expect(quotation.items[0].unitPrice.sourceIds).toEqual([parsed.sources.find(source => source.text === row)!.id]);
    expect(quotation.items[0].currency.sourceIds).toEqual([parsed.sources[1].id]);
  });

  it.each([
    { before: "Unallocated handling unit price USD 7", continuation: undefined },
    { before: undefined, continuation: "Scope: Install wiring and supply instructions" },
  ])("keeps unreferenced substantive target text unresolved: %j", async extra => {
    const { quotation, parsed } = await run(extra);
    const omitted = parsed.sources.find(source => source.text === (extra.before ?? extra.continuation))!;
    expect(quotation.status).toBe("partial");
    expect(quotation.items).toHaveLength(1);
    expect(coverage(quotation).some(issue => issue.sourceIds.includes(omitted.id))).toBe(true);
    expect(quotation.sources).toEqual(parsed.sources);
  });

  it("resolves an item-specific charge through an already validated item source", async () => {
    const { quotation } = await run({ charge: true });
    expect(quotation.charges).toHaveLength(1);
    expect(quotation.charges[0]).toMatchObject({ amount: { value: "5" }, appliesTo: "item", itemId: quotation.items[0].id });
    expect(coverage(quotation)).toEqual([]);
  });

  it("retains numeric evidence rejection across the new provider adapter", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(run({ badPrice: true })).rejects.toMatchObject({ code: "invalid_evidence" });
  });
});
