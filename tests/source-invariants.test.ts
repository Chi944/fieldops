import { describe, expect, it } from "vitest";
import { demoComparisons } from "../src/lib/demo";
import type { FieldValue } from "../src/lib/domain/types";

function statedFields(value: unknown, path = ""): { path: string; field: FieldValue }[] {
  if (!value || typeof value !== "object") return [];
  if ("state" in value && "origin" in value && "sourceIds" in value) return [{ path, field: value as FieldValue }];
  return Object.entries(value).flatMap(([key, child]) => statedFields(child, path ? `${path}.${key}` : key));
}
const normalized = (value: string): string => value.replace(/\s+/g, " ").trim();

describe("authored demo source invariants", () => {
  it("preserves exact source offsets and quotation ownership", () => {
    const quotes = demoComparisons().flatMap(comparison => comparison.quotations);
    for (const quote of quotes) {
      expect(quote.originalText).toBeDefined();
      expect(new Set(quote.sources.map(source => source.id)).size).toBe(quote.sources.length);
      for (const source of quote.sources) {
        expect(source.documentId).toBe(quote.documentId);
        expect(source.kind).toBe("text");
        expect(quote.originalText!.slice(source.start, source.end)).toBe(source.text);
      }
    }
  });
  it("retains a real excerpt for every supplier-stated demo value", () => {
    const discrepancies: string[] = [];
    for (const quote of demoComparisons().flatMap(comparison => comparison.quotations)) {
      const sources = new Map(quote.sources.map(source => [source.id, source]));
      for (const { field, path } of statedFields(quote)) {
        if (field.origin !== "supplier" || field.state !== "value") continue;
        if (!field.sourceIds.length || field.sourceIds.some(id => !sources.has(id))) { discrepancies.push(`${quote.id}:${path}: missing source`); continue; }
        const original = normalized(field.sourceIds.map(id => sources.get(id)!.text).join(" "));
        if (!field.raw || !original.includes(normalized(field.raw))) discrepancies.push(`${quote.id}:${path}: raw excerpt absent from source`);
      }
    }
    expect(discrepancies).toEqual([]);
  });
});
