import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractQuotation } from "@/lib/ai";
import type { ExtractedAttribute, ExtractedChunk, ExtractedField } from "@/lib/ai/schema";
import { parseDocument } from "@/lib/processing";

beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

type Sources = { item: string; tier: string; other: string };
async function extract(raw = "10-19 at 8.25", change?: (chunk: ExtractedChunk, sources: Sources) => void, extra = "") {
  const parsed = await parseDocument({ documentId: "tier-range-synthetic", filename: "self-created.txt", text: `Widget quantity 2 each unit price 10.00 line amount 20.00 currency USD\nAll-unit tiers (each): ${raw}. ${extra}\nReference copy: ${raw}` });
  const sources = { item: parsed.sources[0].id, tier: parsed.sources[1].id, other: parsed.sources[2].id };
  const field = <K extends ExtractedField["key"]>(key: K, value: string): ExtractedField & { key: K } => ({ key, label: key, type: "text", state: "value", value, raw: value, unit: null, sourceIds: [sources.item] });
  const attribute: ExtractedAttribute = { key: "tier.t1.max", label: "Tier maximum", type: "decimal", state: "value", value: "19", raw, unit: null, sourceIds: [sources.tier] };
  const chunk: ExtractedChunk = { supplier: [], quotation: [], terms: [], attributes: [], charges: [], uncertainties: [],
    items: [{ sourceIds: [sources.item], kind: "goods", taxBasis: "not_stated", fields: [field("description", "Widget"), field("quantity", "2"), field("unit", "each"), field("unitPrice", "10.00"), field("lineAmount", "20.00"), field("currency", "USD")],
      tiers: [{ min: "10", max: "19", unitPrice: "8.25", unit: "each", basis: "all_units", sourceIds: [sources.tier] }], discount: null, attributes: [attribute] }],
    coverage: parsed.sources.map(source => ({ sourceId: source.id, disposition: source.id === sources.other ? "non_quotation" : "used", reason: "Self-created evidence fixture" })),
  };
  change?.(chunk, sources);
  const before = structuredClone(chunk);
  const quotation = await extractQuotation(parsed, { request: async () => ({ data: chunk, model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, usageAvailable: false }) });
  expect(chunk).toEqual(before);
  return { quotation, chunk, sources };
}

describe("same-item complete-tier upper-bound evidence", () => {
  it("accepts the exact interval or priced clause while preserving raw values and source arrays", async () => {
    for (const raw of ["10-19", "10 - 19 at 8.25", "10–19 at 8,25", "10 — 19 at 8.25"]) {
      const { quotation, chunk, sources } = await extract(raw, undefined, "Tier price 8.25");
      expect(quotation.items[0].attributes[0].value).toMatchObject({ value: "19", raw, sourceIds: [sources.tier] });
      expect(quotation.items[0].tiers).toEqual(chunk.items[0].tiers);
    }
  });

  it("requires both endpoints and the optional price to match the same complete tier", async () => {
    const mutations: ((chunk: ExtractedChunk) => void)[] = [
      chunk => { chunk.items[0].tiers[0].min = "11"; },
      chunk => { chunk.items[0].tiers[0].max = "20"; },
      chunk => { chunk.items[0].tiers[0].unitPrice = "8.50"; },
      chunk => { chunk.items[0].attributes[0].value = "10"; },
    ];
    for (const change of mutations) await expect(extract("10-19 at 8.25", change, "Other reference numbers: 11 20 8.50")).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(extract("10-1,000 at 8.25", chunk => {
      chunk.items[0].tiers[0].max = "1000"; chunk.items[0].attributes[0].value = "1";
    })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("requires a shared parser source, not another record containing the same text", async () => {
    await expect(extract("10-19 at 8.25", (chunk, sources) => { chunk.items[0].attributes[0].sourceIds = [sources.other]; })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("requires a decoded tier on this item with explicit basis, unit and closed ordered nonnegative bounds", async () => {
    const mutations: ((chunk: ExtractedChunk) => void)[] = [
      chunk => { chunk.items[0].tiers = []; },
      chunk => { chunk.items[0].tiers[0].basis = "ambiguous"; },
      chunk => { chunk.items[0].tiers[0].unit = ""; },
      chunk => { chunk.items[0].tiers[0].max = null; },
      chunk => { chunk.items[0].tiers[0].min = "20"; },
      chunk => { chunk.items[0].tiers[0].min = "-10"; },
      chunk => { chunk.items[0].tiers[0].unitPrice = "-8.25"; },
    ];
    for (const change of mutations) await expect(extract("10-19 at 8.25", change, "Other references: 20 -10 -8.25; 10 and above")).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(extract("10-19 at 8.25", (chunk, sources) => {
      const other = structuredClone(chunk.items[0]); other.sourceIds = [sources.other]; other.attributes = [];
      other.fields = [{ ...other.fields[0], value: "Reference copy", raw: "Reference copy", sourceIds: [sources.other] }];
      chunk.items[0].tiers = []; chunk.items.unshift(other);
    })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("does not apply the exception to arbitrary attributes, other rule keys or quotation attributes", async () => {
    for (const key of ["unrelated", "tier.t1.min", "tier.t1.unitPrice", "discount.t1.max"]) {
      await expect(extract("10-19 at 8.25", chunk => { chunk.items[0].attributes[0].key = key; })).rejects.toMatchObject({ code: "invalid_evidence" });
    }
    await expect(extract("10-19 at 8.25", chunk => { chunk.attributes = chunk.items[0].attributes; chunk.items[0].attributes = []; })).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("rejects dates, multiple segments, signed bounds and arbitrary surrounding text", async () => {
    for (const raw of ["2026-09-19", "10-19-29", "10-19 or 30-39", "-10-19", "10--19", "between 10-19", "10-19 at 8.25 extra", "10-19 at -8.25"]) {
      await expect(extract(raw, undefined, "Reference values: 10 19 8.25")).rejects.toMatchObject({ code: "invalid_evidence" });
    }
  });

  it("never treats a standalone negative price as positive or widens a claimed excerpt", async () => {
    await expect(extract("10-19 at 8.25", (chunk, sources) => {
      Object.assign(chunk.items[0].fields.find(field => field.key === "unitPrice")!, { raw: "-10.00", sourceIds: [sources.tier] });
    }, "Standalone adjustment -10.00")).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(extract("10-19 at 8.25", chunk => { chunk.items[0].attributes[0].raw = "10 - 19 at 8.25"; })).rejects.toMatchObject({ code: "invalid_evidence" });
  });
});
