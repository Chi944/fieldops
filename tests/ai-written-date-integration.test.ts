import { afterEach, describe, expect, it, vi } from "vitest";
import { extractQuotation } from "../src/lib/ai";
import { parseDocument } from "../src/lib/processing";
import type { ExtractedChunk } from "../src/lib/ai/schema";

async function interpret(value: string | null, raw: string, original = raw, state: "value" | "ambiguous" = "value", attribute = false) {
  const parsed = await parseDocument({ documentId: "synthetic-date", filename: "date.txt", text: `Quotation date: ${original}` });
  const field = { key: attribute ? "milestoneDate" : "date", label: "Date", type: "date" as const, state, value, raw, unit: null, sourceIds: [parsed.sources[0].id] };
  const data: ExtractedChunk = { supplier: [], quotation: attribute ? [] : [{ ...field, key: "date" }], terms: [], items: [], charges: [], attributes: attribute ? [field] : [], uncertainties: [], coverage: [{ sourceId: parsed.sources[0].id, disposition: "used", reason: "Stated date" }] };
  const originalResponse = structuredClone(data);
  const quotation = await extractQuotation(parsed, { request: async () => ({ data, model: "SYNTHETIC-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null }) });
  expect(data).toEqual(originalResponse);
  expect(quotation.sources).toEqual(parsed.sources);
  return { quotation, sourceId: parsed.sources[0].id };
}
afterEach(() => vi.restoreAllMocks());

describe("written-date normalization at the domain evidence boundary", () => {
  it.each([false, true])("preserves the exact model response and supplier excerpt for attribute=%s", async attribute => {
    const { quotation, sourceId } = await interpret("7 January 2028", "7 January 2028", undefined, "value", attribute);
    const date = attribute ? quotation.attributes[0].value : quotation.date;
    expect(date).toEqual({ state: "value", value: "2028-01-07", raw: "7 January 2028", sourceIds: [sourceId], origin: "supplier" });
    expect(quotation.status).toBe("partial"); // A date-only source is not a complete quotation.
  });

  it("does not guess an ambiguous numeric date", async () => {
    const { quotation } = await interpret(null, "01/02/2028", undefined, "ambiguous");
    expect(quotation.date).toMatchObject({ state: "ambiguous", value: null, raw: "01/02/2028" });
    expect(quotation.issues.some(issue => issue.code === "ambiguous_value")).toBe(true);
  });

  it.each([
    ["7 January 2028", "7 January 2028", "7 January 2029", "invalid_evidence"],
    ["7 January 2028", "7 January 2029", "7 January 2029", "invalid_output"],
    ["31 April 2028", "31 April 2028", "31 April 2028", "invalid_output"],
    ["01/02/2028", "01/02/2028", "01/02/2028", "invalid_output"],
    ["2028-02-30", "30 February 2028", "30 February 2028", "invalid_output"],
  ])("rejects unsupported date normalization: %s / %s / %s", async (value, raw, original, code) => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(interpret(value, raw, original)).rejects.toMatchObject({ code });
  });
});
