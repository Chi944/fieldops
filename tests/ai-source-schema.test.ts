import { describe, expect, it } from "vitest";
import { compactExtractionRequest } from "../src/lib/ai/groq";

describe("parser-owned source constraints in extraction requests", () => {
  it("allows exclusion of target records without allowing the observed context exclusion", () => {
    const original = { purpose: "extraction" as const, transport: "quotation-v4" as const, schema: {}, system: "Synthetic quotation", maxOutputTokens: 3600,
      user: JSON.stringify({ sources: [{ id: "document:row:1", text: "Widget" }, { id: "document:row:2", text: "Page 2" }], context: [{ id: "document:header", text: "Currency: SGD" }] }) };
    const wire = compactExtractionRequest(original);
    const schema = wire.request.schema as { properties: { excluded: { items: { properties: { sourceIds: { items: { type: string; enum?: string[] } } } } } } };
    expect(schema.properties.excluded.items.properties.sourceIds.items).toEqual({ type: "string", enum: ["s0", "s1"] });
    expect(schema.properties.excluded.items.properties.sourceIds.items.enum).not.toContain("s2");
    // Decoding constraints supplement, and never replace, runtime reference checks.
    expect(() => wire.restore({ fields: [], items: [], charges: [], excluded: [{ sourceIds: ["s0", "s1", "s2"], disposition: "header", reason: "Page context" }], uncertainties: [] })).toThrow(/coverage/);
    expect(() => wire.restore({ sourceIds: ["invented"] })).toThrow(/Unknown evidence alias/);
    expect(original.schema).toEqual({});
  });
});
