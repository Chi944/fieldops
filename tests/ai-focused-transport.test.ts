import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { expandFocusedExtraction, focusedExtractionWireSchema, focusedProviderSchema, planFocusedExtraction, type FocusedDescriptor } from "@/lib/ai/focused-transport";
import { sectionFieldKeys } from "@/lib/ai/schema";
import { parseDocument } from "@/lib/processing";
import type { ParsedDocument, SourceSpan } from "@/lib/domain/types";

interface Field { state: "value" | "not_stated" | "not_applicable" | "ambiguous"; value: string | null; raw: string | null; sourceIds: string[]; }
const absent = (): Field => ({ state: "not_stated", value: null, raw: null, sourceIds: [] });
const field = (value: string, sourceId: string, raw = value): Field => ({ state: "value", value, raw, sourceIds: [sourceId] });
function item(source = "a") {
  return { description: field("Widget", source), identifier: field("W-1", source), quantity: field("2", source), unit: field("each", source), unitPrice: field("10", source), lineAmount: field("20", source), currency: absent(),
    fields: [] as (Field & { key: string })[], attributes: [] as (Field & { key: string; type: "text" | "decimal" })[], kind: "goods", taxBasis: "not_stated", tiers: [], discounts: [] };
}
function descriptor(): FocusedDescriptor { return { kind: "items", targetIds: ["a", "continuation", "b"], contextIds: ["context"], slots: [{ id: "i1", sourceIds: ["a", "continuation"] }, { id: "i2", sourceIds: ["b"] }], structuralHeaderIds: [] }; }
function documentWire() { return { supplier: Object.fromEntries(sectionFieldKeys.supplier.map(key => [key, absent()])), quotation: Object.fromEntries(sectionFieldKeys.quotation.map(key => [key, absent()])), terms: Object.fromEntries(sectionFieldKeys.terms.map(key => [key, absent()])), charges: [] as { label: Field; kind: Field; amount: Field; currency: Field; billingPeriod: Field; appliesTo: Field; itemSourceId: string | null; attributes: [] }[], attributes: [], uncertainties: [] }; }
async function parsedText(text: string) { return parseDocument({ documentId: "focused-self-created", filename: "quote.txt", text }); }
function sheetParsed(sources: SourceSpan[], template: ParsedDocument): ParsedDocument { return { ...template, sources: sources.map(source => ({ ...source, documentId: template.documentId })) }; }
function cell(id: string, name: string, text: string): SourceSpan { return { id, documentId: "focused-self-created", kind: "sheet", sheet: "Quote", cell: name, text }; }

describe("focused task planning", () => {
  it("keeps two explicit items per batch, their continuations intact and every target exactly once", async () => {
    const parsed = await parsedText("Supplier: Acme\n1. Widget | ID W1\nQuantity 2 each unit price 10\nMinimum order: 4 each\n2. Service | ID S1\nQuantity 1 hour unit price 20\nScope: installation only\n3. Part | ID P1\nQuantity 5 each unit price 3\nPayment: Net 30\nUnexpected quotation note");
    const tasks = planFocusedExtraction(parsed);
    expect(tasks.map(task => task.kind)).toEqual(["items", "items", "document"]);
    expect(tasks[0].slots).toHaveLength(2); expect(tasks[1].slots).toHaveLength(1);
    expect(tasks[0].slots[0].sourceIds).toContain(parsed.sources[3].id);
    expect(tasks[0].slots[1].sourceIds).toContain(parsed.sources[6].id);
    expect(tasks.at(-1)!.sources.map(source => source.id)).toContain(parsed.sources.at(-1)!.id);
    const ids = tasks.flatMap(task => task.sources.map(source => source.id));
    expect(new Set(ids).size).toBe(parsed.sources.length); expect(ids.slice().sort()).toEqual(parsed.sources.map(source => source.id).sort());
  });

  it("routes exact repeated page-start preambles to document targets without exempting their values", async () => {
    const template = await parsedText("Synthetic");
    const texts = ["Supplier: Acme", "Currency: USD", "1. Widget | ID W1", "Quantity 2 each unit price 10", "Supplier: Acme", "Currency: USD", "2. Part | ID W2", "Quantity 3 each unit price 20"];
    const sources: SourceSpan[] = texts.map((text, index) => ({ id: `p${index}`, documentId: template.documentId, kind: "pdf_text", text, page: index < 4 ? 1 : 2, box: { x: 10, y: (index % 4) * 20, width: 100, height: 10 }, pageWidth: 400, pageHeight: 600 }));
    const parsed = { ...template, sources }, tasks = planFocusedExtraction(parsed), doc = tasks.at(-1)!;
    expect(doc.sources.map(source => source.id)).toEqual(["p0", "p1", "p4", "p5"]);
    expect(doc.structuralHeaderIds).toEqual([]);
    const result = expandFocusedExtraction(documentWire(), { kind: "document", targetIds: doc.sources.map(source => source.id), contextIds: doc.context.map(source => source.id), slots: [], structuralHeaderIds: [] });
    expect(result.coverage.filter(row => doc.sources.some(source => source.id === row.sourceId)).every(row => row.disposition === "uninterpreted")).toBe(true);
    expect(tasks.flatMap(task => task.sources)).toHaveLength(sources.length);
  });

  it("recognizes whole sheet header rows but never a priced item named Qty or Total", async () => {
    const template = await parsedText("Synthetic");
    const sources = [cell("h1", "A1", "Description"), cell("h2", "B1", "Qty"), cell("h3", "C1", "Unit price"), cell("a", "A2", "Qty"), cell("b", "B2", "2"), cell("c", "C2", "10"), cell("d", "B3", "Continuation scope"), cell("e", "A4", "Total"), cell("f", "B4", "3"), cell("g", "C4", "12")];
    const tasks = planFocusedExtraction(sheetParsed(sources, template));
    expect(tasks.at(-1)!.structuralHeaderIds).toEqual(["h1", "h2", "h3"]);
    expect(tasks[0].slots[0].sourceIds).toEqual(["a", "b", "c", "d"]);
    expect(tasks.at(-1)!.context.map(source => source.id)).toEqual(["a", "e"]);
    expect(tasks.flatMap(task => task.sources.map(source => source.id)).sort()).toEqual(sources.map(source => source.id).sort());
  });

  it("fails explicitly on oversize bundles, document context and invalid ownership without cropping", async () => {
    const parsed = await parsedText("Supplier: Acme\n1. Widget | ID W1\nScope: " + "x".repeat(1000));
    expect(() => planFocusedExtraction(parsed, { maxItemCharacters: 100 })).toThrow(/continuation|budget/);
    expect(() => planFocusedExtraction(parsed, { maxDocumentCharacters: 10 })).toThrow(/Document details/);
    expect(() => planFocusedExtraction(parsed, { maxDocumentContextCharacters: 10 })).toThrow(/anchors/);
    expect(() => planFocusedExtraction({ ...parsed, sources: [...parsed.sources, parsed.sources[0]] })).toThrow(/ownership|identifiers/);
  });

  it("routes labelled spreadsheet summaries globally while keeping priced items named Total and Terms", async () => {
    const template = await parsedText("Synthetic");
    const sources = [cell("a", "A1", "1. Widget | ID W1"), cell("b", "B1", "2"), cell("c", "C1", "10"), cell("scope", "B2", "Included setup"),
      cell("summary", "A3", "Terms"), cell("payment", "B3", "Payment: Net 30"), cell("total-item", "A4", "Total"), cell("d", "B4", "3"), cell("e", "C4", "12"),
      cell("terms-item", "A5", "Terms"), cell("f", "B5", "4"), cell("g", "C5", "15"), cell("totals", "A6", "Totals"), cell("subtotal", "B6", "Subtotal: 70")];
    const tasks = planFocusedExtraction(sheetParsed(sources, template));
    expect(tasks.flatMap(task => task.slots.map(slot => slot.sourceIds))).toEqual([["a", "b", "c", "scope"], ["total-item", "d", "e"], ["terms-item", "f", "g"]]);
    expect(tasks.at(-1)!.sources.map(source => source.id)).toEqual(["summary", "payment", "totals", "subtotal"]);
    expect(tasks.flatMap(task => task.sources.map(source => source.id)).sort()).toEqual(sources.map(source => source.id).sort());
  });
});

describe("focused extraction wire and evidence boundaries", () => {
  it("requires closed caller-owned slots and every core field without object unions", () => {
    const schema = focusedProviderSchema(focusedExtractionWireSchema("items", ["i1", "i2"], ["a", "b", "context"]));
    expect(JSON.stringify(schema)).not.toMatch(/"(?:anyOf|oneOf|allOf)"/);
    const validate = new Ajv().compile(schema), valid = { items: { i1: item("a"), i2: item("b") }, uncertainties: [] };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, items: { i1: item("a") } })).toBe(false);
    expect(validate({ ...valid, items: { ...valid.items, i3: item("b") } })).toBe(false);
    const missing = structuredClone(valid) as { items: Record<string, Record<string, unknown>>; uncertainties: unknown[] }; delete missing.items.i1.identifier;
    expect(validate(missing)).toBe(false);
    const decimal = structuredClone(valid); decimal.items.i1.quantity.value = "2 each"; expect(validate(decimal)).toBe(false);
  });

  it("derives coverage only from fields, preserves raw evidence and leaves uncited continuations unresolved", () => {
    const data = { items: { i1: item("a"), i2: item("b") }, uncertainties: [] }, before = structuredClone(data);
    data.items.i1.currency = field("USD", "context"); before.items.i1.currency = structuredClone(data.items.i1.currency);
    const result = expandFocusedExtraction(data, descriptor());
    expect(data).toEqual(before);
    expect(result.items[0].sourceIds).toEqual(["a"]);
    expect(result.items[0].fields.find(field => field.key === "identifier")).toMatchObject({ raw: "W-1", sourceIds: ["a"] });
    expect(result.coverage.find(row => row.sourceId === "continuation")?.disposition).toBe("uninterpreted");
    expect(result.coverage.find(row => row.sourceId === "context")?.disposition).toBe("used");
  });

  it("rejects another item's citations, context-only anchors, foreign sources and malformed slot assignments", () => {
    const bad = { items: { i1: item("b"), i2: item("b") }, uncertainties: [] };
    expect(() => expandFocusedExtraction(bad, descriptor())).toThrow(/another slot/);
    bad.items.i1 = item("context"); expect(() => expandFocusedExtraction(bad, descriptor())).toThrow(/own target/);
    bad.items.i1 = item("foreign"); expect(() => expandFocusedExtraction(bad, descriptor())).toThrow();
    const good = { items: { i1: item("a"), i2: item("b") }, uncertainties: [] };
    expect(() => expandFocusedExtraction(good, { ...descriptor(), slots: [{ id: "i1", sourceIds: ["a"] }, { id: "i1", sourceIds: ["b", "continuation"] }] })).toThrow(/slots/);
    expect(() => expandFocusedExtraction(good, { ...descriptor(), slots: [{ id: "i1", sourceIds: ["a", "continuation"] }, { id: "i2", sourceIds: ["a", "b"] }] })).toThrow(/partition/);
  });

  it("keeps absent states distinct, rejects contradictions and prevents core facts hiding as attributes", () => {
    const data = { items: { i1: item("a"), i2: item("b") }, uncertainties: [] };
    data.items.i1.identifier = absent();
    expect(expandFocusedExtraction(data, descriptor()).items[0].fields.some(field => field.key === "identifier")).toBe(false);
    data.items.i1.identifier = { ...field("W-1", "a"), state: "not_stated" };
    expect(() => expandFocusedExtraction(data, descriptor())).toThrow(/state/i);
    data.items.i1.identifier = absent(); data.items.i1.attributes.push({ ...field("2", "a"), key: "quantity", type: "decimal" });
    expect(expandFocusedExtraction(data, descriptor()).coverage.find(row => row.sourceId === "a")?.disposition).toBe("uninterpreted");
    data.items.i1.attributes = [{ ...field("9", "a"), key: "taxRate", type: "decimal" }];
    expect(expandFocusedExtraction(data, descriptor()).coverage.find(row => row.sourceId === "a")?.disposition).toBe("uninterpreted");
  });

  it("exempts only caller-verified structural headers, never arbitrary uncited targets or context", () => {
    const task: FocusedDescriptor = { kind: "document", targetIds: ["h", "substantive"], contextIds: ["context"], slots: [], structuralHeaderIds: ["h"] };
    const result = expandFocusedExtraction(documentWire(), task);
    expect(result.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "h", disposition: "header" }), expect.objectContaining({ sourceId: "substantive", disposition: "uninterpreted" }), expect.objectContaining({ sourceId: "context", disposition: "header" })]));
    expect(() => expandFocusedExtraction(documentWire(), { ...task, structuralHeaderIds: ["context"] })).toThrow(/ownership/);
  });

  it("preserves charge metadata evidence and blocks missing, ambiguous or unsupported charge scope", () => {
    const task: FocusedDescriptor = { kind: "document", targetIds: ["charge"], contextIds: ["anchor"], slots: [], structuralHeaderIds: [] };
    const data = documentWire();
    data.charges.push({ label: field("Shipping", "charge"), kind: field("shipping", "charge", "Shipping"), amount: field("5", "charge"), currency: field("USD", "charge"), billingPeriod: absent(), appliesTo: field("quotation", "charge", "per quotation"), itemSourceId: null, attributes: [] });
    const valid = expandFocusedExtraction(data, task);
    expect(valid.charges[0]).toMatchObject({ kind: "shipping", billingPeriod: null, appliesTo: "quotation" });
    expect(valid.attributes).toContainEqual(expect.objectContaining({ key: "metadata.kind", raw: "Shipping", sourceIds: ["charge"] }));
    expect(valid.coverage.find(row => row.sourceId === "charge")?.disposition).toBe("used");
    for (const replacement of [absent(), { ...field("quotation", "charge"), state: "ambiguous" as const, value: null }, field("quotation", "charge", "per item")]) {
      data.charges[0].appliesTo = replacement;
      expect(expandFocusedExtraction(data, task).coverage.find(row => row.sourceId === "charge")?.disposition).toBe("uninterpreted");
    }
    data.charges[0].appliesTo = field("item", "charge", "per item"); data.charges[0].itemSourceId = "charge";
    expect(() => expandFocusedExtraction(data, task)).toThrow(/item anchor/);
    data.charges[0].itemSourceId = "anchor";
    expect(expandFocusedExtraction(data, task).charges[0].itemSourceId).toBe("anchor");
  });
});
