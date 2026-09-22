import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { normalizeWrittenDate } from "@/lib/ai/dates";
import { focusedExtractionInstruction, focusedExtractionWireSchema, focusedProviderSchema } from "@/lib/ai/focused-transport";
import { sectionFieldKeys } from "@/lib/ai/schema";

describe("source-backed full-month calendar normalization", () => {
  it("normalizes complete English month dates without rewriting their evidence", () => {
    for (const [value, expected] of [["7 January 2028", "2028-01-07"], ["January 07, 2028", "2028-01-07"], ["DECEMBER 31 2028", "2028-12-31"], ["29 February 2000", "2000-02-29"], ["1 March 0001", "0001-03-01"]]) {
      const field = { value, raw: `Quotation date: ${value}.`, sourceIds: ["original-record"] }, original = structuredClone(field);
      expect(normalizeWrittenDate(field.value, field.raw)).toBe(expected);
      expect(field).toEqual(original);
    }
  });

  it("requires the exact model value as a complete literal in its existing raw excerpt", () => {
    expect(normalizeWrittenDate("7 January 2028", "Date: 7 January 2029")).toBeNull();
    expect(normalizeWrittenDate("7 January 2028", "Date: 7 JANUARY 2028")).toBeNull();
    expect(normalizeWrittenDate("7 January 2028", "Date: 7  January 2028")).toBeNull();
    expect(normalizeWrittenDate("7 January 2028", "")).toBeNull();
    expect(normalizeWrittenDate("1 January 2028", "11 January 2028")).toBeNull();
    expect(normalizeWrittenDate("1 January 2028", "1 January 20280")).toBeNull();
    expect(normalizeWrittenDate("January 7 2028", "NotJanuary 7 2028")).toBeNull();
  });

  it("rejects ambiguous numeric dates, partial dates, abbreviations and attempted OCR repairs", () => {
    for (const value of ["01/02/2028", "2028-01-02", "7 January 28", "January 2028", "7 Jan 2028", "7th January 2028", "7 January 2O28", "7 janvier 2028", "7 January 2028 at 09:00", "7 January 2028–8 January 2028", " 7 January 2028", "7 January 2028 ", "7 January 2028\n"]) expect(normalizeWrittenDate(value, value)).toBeNull();
  });

  it("validates the real calendar without Date.parse rollover or timezone assumptions", () => {
    for (const value of ["29 February 1900", "29 February 2027", "31 April 2028", "32 January 2028", "0 January 2028", "1 January 0000"]) expect(normalizeWrittenDate(value, value)).toBeNull();
    expect(normalizeWrittenDate("29 February 2028", "29 February 2028")).toBe("2028-02-29");
    expect(normalizeWrittenDate("28 February 1900", "28 February 1900")).toBe("1900-02-28");
  });
});

describe("focused core date wire contract", () => {
  it("requires ISO-shaped date values while preserving explicit ambiguous and absent states", () => {
    const absent = () => ({ state: "not_stated", value: null, raw: null, sourceIds: [] as string[] });
    const section = (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, absent()]));
    const data = { supplier: section(sectionFieldKeys.supplier), quotation: section(sectionFieldKeys.quotation), terms: section(sectionFieldKeys.terms), charges: [], attributes: [], uncertainties: [] };
    const wire = focusedExtractionWireSchema("document", [], ["source"]), validate = new Ajv().compile(focusedProviderSchema(wire));
    const date = (value: string | null, state = "value") => ({ ...data, quotation: { ...data.quotation, date: { state, value, raw: "7 January 2028", sourceIds: ["source"] } } });
    expect(validate(date("2028-01-07"))).toBe(true);
    expect(wire.safeParse(date("2028-01-07")).success).toBe(true);
    for (const value of ["7 January 2028", "01/07/2028", "2028-1-7", "2028-01-07T00:00:00Z"]) {
      expect(validate(date(value))).toBe(false);
      expect(wire.safeParse(date(value)).success).toBe(false);
    }
    expect(validate(date(null, "ambiguous"))).toBe(true);
    expect(validate(data)).toBe(true);
    expect(focusedExtractionInstruction("document")).toContain("YYYY-MM-DD");
    expect(focusedExtractionInstruction("document")).toContain("ambiguous");
  });
});
