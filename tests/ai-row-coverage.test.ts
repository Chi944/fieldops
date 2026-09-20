import { describe, expect, it } from "vitest";
import { extractQuotation, type AIRequest } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import type { ExtractedChunk, ExtractedField } from "@/lib/ai/schema";
import type { ParsedDocument, SourceSpan } from "@/lib/domain/types";

const fact = <K extends ExtractedField["key"]>(key: K, value: string, source: SourceSpan): ExtractedField & { key: K } => ({ key, label: key, type: "text", state: "value", value, raw: value, unit: null, sourceIds: [source.id] });
const empty = (): ExtractedChunk => ({ supplier: [], quotation: [], terms: [], items: [], charges: [], attributes: [], coverage: [], uncertainties: [] });
async function injected(parsed: ParsedDocument, populate: (data: ExtractedChunk, sources: SourceSpan[]) => void) {
  return extractQuotation(parsed, { request: async (request: AIRequest) => {
    const input = JSON.parse(request.user) as { sources: { id: string }[]; context: { id: string }[] };
    const sources = [...input.sources, ...input.context].map(value => parsed.sources.find(source => source.id === value.id)!);
    const data = empty(); populate(data, sources);
    const used = new Set<string>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "sourceIds" && Array.isArray(child)) child.forEach(id => used.add(id)); else collect(child);
      }
    };
    collect(data);
    data.coverage = sources.map(source => ({ sourceId: source.id, disposition: used.has(source.id) ? "used" : "header", reason: "Injected synthetic omission or extracted evidence" }));
    return { model: "INJECTED-NO-PROVIDER", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, data };
  } });
}
function item(fields: ExtractedChunk["items"][number]["fields"]): ExtractedChunk["items"][number] {
  return { sourceIds: [...new Set(fields.flatMap(field => field.sourceIds))], kind: "goods", fields, taxBasis: "not_stated", tiers: [], discount: null, attributes: [] };
}
const fields = (sources: SourceSpan[], row: string) => (["description", "quantity", "unit", "unitPrice", "lineAmount"] as const).map((key, index) => {
  const source = sources.find(source => source.cell === `${String.fromCharCode(65 + index)}${row}`)!;
  return fact(key, source.text, source);
});
async function sheet() {
  return parseDocument({ documentId: "synthetic-row-coverage", filename: "synthetic.csv", bytes: Buffer.from("Description,Quantity,Unit,Unit price,Line amount\nWidget A,2,each,10,20\nWidget B,2,each,10,20") });
}
const omissions = (quotation: Awaited<ReturnType<typeof extractQuotation>>) => quotation.issues.filter(issue => issue.code === "incomplete_extraction" && issue.message.includes("possible priced row"));

describe("source coverage examines possible priced rows, not only individual cells", () => {
  it("marks an omitted integer-priced spreadsheet row for review even when every cell is called a header", async () => {
    const parsed = await sheet();
    const quote = await injected(parsed, (data, sources) => { if (sources.some(source => source.cell === "A2")) data.items.push(item(fields(sources, "2"))); });
    expect(quote.items).toHaveLength(1); expect(quote.status).toBe("partial");
    expect(omissions(quote)).toContainEqual(expect.objectContaining({ resolved: false, sourceIds: parsed.sources.filter(source => source.cell?.endsWith("3")).map(source => source.id) }));
  });

  it("does not let a generic attribute or bare item anchor turn an omitted row into completed interpretation", async () => {
    const parsed = await sheet();
    const quote = await injected(parsed, (data, sources) => {
      if (sources.some(source => source.cell === "A2")) data.items.push(item(fields(sources, "2")));
      const omitted = sources.find(source => source.cell === "A3");
      if (omitted) {
        data.attributes.push({ ...fact("notes", "Widget B", omitted), key: "extra_information", label: "Extra information" });
        if (data.items[0]) data.items[0].sourceIds.push(omitted.id);
      }
    });
    expect(quote.attributes[0].value.value).toBe("Widget B");
    expect(quote.status).toBe("partial"); expect(omissions(quote)).toHaveLength(1);
  });

  it("preserves complete integer-priced rows and source references without inventing items", async () => {
    const parsed = await sheet();
    const quote = await injected(parsed, (data, sources) => {
      for (const row of ["2", "3"]) if (sources.some(source => source.cell === `A${row}`)) data.items.push(item(fields(sources, row)));
    });
    expect(quote.items).toHaveLength(2); expect(omissions(quote)).toEqual([]); expect(quote.status).toBe("ready");
  });

  it("accepts source-backed price continuation lines and explicit charge amounts", async () => {
    const parsed = await parseDocument({ documentId: "vertical-row-coverage", filename: "synthetic.txt", text: "Widget A\nQuantity 2 each\nUnit price 10\nLine amount 20\nSetup quantity 1 each unit price 5 amount 5" });
    const quote = await injected(parsed, (data, sources) => {
      data.items.push(item([fact("description", "Widget A", sources[0]), fact("quantity", "2", sources[1]), fact("unit", "each", sources[1]), fact("unitPrice", "10", sources[2]), fact("lineAmount", "20", sources[3])]));
      data.charges.push({ kind: "setup", label: "Setup", fields: [fact("amount", "5", sources[4])], appliesTo: "quotation", billingPeriod: null, itemSourceId: null });
    });
    expect(quote.items).toHaveLength(1); expect(quote.charges).toHaveLength(1); expect(omissions(quote)).toEqual([]);
  });

  it("flags a fully cited priced text row that was preserved only as an extra attribute", async () => {
    const parsed = await parseDocument({ documentId: "text-row-coverage", filename: "synthetic.txt", text: "Widget A quantity 2 each unit price 10 line amount 20\nCable quantity 2 each unit price 10 line amount 20" });
    const quote = await injected(parsed, (data, sources) => {
      data.items.push(item([fact("description", "Widget A", sources[0]), fact("quantity", "2", sources[0]), fact("unit", "each", sources[0]), fact("unitPrice", "10", sources[0]), fact("lineAmount", "20", sources[0])]));
      data.attributes.push({ ...fact("notes", "Cable", sources[1]), key: "cable_note", label: "Cable note" });
    });
    expect(quote.status).toBe("partial"); expect(omissions(quote)).toHaveLength(1);
    expect(quote.items).toHaveLength(1); // The guard asks for review; it never synthesizes a missing item.
  });

  it("retains every omitted row's evidence when several extraction sections need the same review", async () => {
    const parsed = await parseDocument({ documentId: "several-row-coverage", filename: "synthetic.csv", bytes: Buffer.from("Description,Quantity,Unit,Unit price,Line amount\nWidget A,2,each,10,20\nWidget B,2,each,10,20\nWidget C,2,each,10,20") });
    const quote = await injected(parsed, (data, sources) => { if (sources.some(source => source.cell === "A2")) data.items.push(item(fields(sources, "2"))); });
    expect(omissions(quote)).toHaveLength(1);
    expect(new Set(omissions(quote)[0].sourceIds)).toEqual(new Set(parsed.sources.filter(source => /[34]$/.test(source.cell ?? "")).map(source => source.id)));
  });
});
