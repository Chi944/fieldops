import type { ParsedDocument, SourceSpan } from "../domain/types";
import { ProcessingError } from "../processing/errors";

export function sourceRecord(source: SourceSpan): Record<string, unknown> {
  return { id: source.id, text: source.text, ...(source.page ? { page: source.page } : {}), ...(source.sheet ? { sheet: source.sheet, cell: source.cell, ...(source.mergedMaster ? { mergedMaster: source.mergedMaster } : {}) } : {}), ...(source.box ? { x: Math.round(source.box.x), y: Math.round(source.box.y) } : {}) };
}
function rows(parsed: ParsedDocument): SourceSpan[][] {
  const result: SourceSpan[][] = []; let previousKey = "";
  for (const source of parsed.sources) {
    const row = source.cell?.match(/\d+$/)?.[0];
    const key = source.kind === "sheet" ? `${source.sheet}:${row}` : source.kind === "pdf_text" && source.box ? `${source.page}:${Math.round(source.box.y / 3)}` : source.id;
    if (key === previousKey) result[result.length - 1].push(source); else result.push([source]);
    previousKey = key;
  }
  return result;
}
/** This heuristic only bounds batching; it never drops or classifies source data. */
export function pricedRow(row: SourceSpan[]): boolean {
  const text = row.map(source => source.text).join(" ");
  if (/\b(?:unit\s*(?:price|rate)|hourly\s*rate)\s*[:=]?\s*(?:[A-Z]{3}\s*)?[$€£¥]?\s*\d/i.test(text)) return true;
  if (/\b(?:qty|quantity)\b.*\d/i.test(text) && /\b(?:price|amount|rate|total)\b.*\d|[$€£¥]\s*\d/i.test(text)) return true;
  if (/\d\s*(?:each|ea|pcs?|packs?|boxes?|pairs?|kg|litres?|liters?|hours?|days?|months?|projects?)\b/i.test(text) && (text.match(/\d+(?:[.,]\d+)?/g)?.length ?? 0) >= 3) return true;
  // Spreadsheet prices may be labelled only in a separate column-header row.
  return row[0]?.kind === "sheet" && row.filter(source => /^\s*[-+]?\d[\d., '\u00a0\u202f]*(?:\s*\[formula:.*)?\s*$/.test(source.text)).length >= 2 && row.some(source => /[a-z]/i.test(source.text)) && !/^\s*(?:sub\s*total|grand total|tax|vat|gst|shipping)\b/i.test(text);
}

export function extractionChunks(parsed: ParsedDocument, maxCharacters = 1400): SourceSpan[][] {
  const chunks: SourceSpan[][] = []; let current: SourceSpan[] = []; let characters = 0, priced = 0;
  for (const row of rows(parsed)) {
    const size = JSON.stringify(row.map(sourceRecord)).length, candidate = pricedRow(row) ? 1 : 0;
    const commercialSummary = /^(?:sub\s*total|grand total|quoted total|total amount|shipping|freight|tax\b|vat\b|gst\b|payment\b|valid (?:until|for)\b|lead time\b|delivery terms\b)/i.test(row.map(source => source.text).join(" ").trim());
    if (size > maxCharacters) throw new ProcessingError("limit_exceeded", "A quotation row or paragraph is too large for the free extraction budget. Split long text into shorter lines or upload a smaller table.");
    if (current.length && (characters + size > maxCharacters || priced + candidate > 3 || (priced > 0 && commercialSummary))) { chunks.push(current); current = []; characters = 0; priced = 0; }
    current.push(...row); characters += size; priced += candidate;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Carry literal table headings and document price context, with original IDs. */
export function extractionContext(parsed: ParsedDocument, targets: SourceSpan[], maxCharacters = 700): SourceSpan[] {
  const ids = new Set(targets.map(source => source.id)), firstTarget = parsed.sources.findIndex(source => ids.has(source.id)), result: SourceSpan[] = []; let characters = 0;
  const sheets = new Set(targets.flatMap(source => source.sheet ? [source.sheet] : []));
  // Nearest headings win the bounded budget. Never borrow another sheet's units
  // or pricing basis merely because it appeared earlier in the workbook.
  for (const row of rows(parsed).reverse()) {
    if (row.some(source => ids.has(source.id)) || pricedRow(row) || parsed.sources.indexOf(row[0]) >= firstTarget) continue;
    if (sheets.size && row.some(source => !source.sheet || !sheets.has(source.sheet))) continue;
    const text = row.map(source => source.text).join(" ");
    const metadata = /\b(?:supplier|currency|decimal (?:point|comma))\s*[:=]|\bprices?\b.*\b(?:tax|vat|gst)\b|\b(?:description|item|product)\b.*\b(?:qty|quantity)\b.*\b(?:price|amount|rate)\b/i.test(text);
    if (!metadata) continue;
    const size = JSON.stringify(row.map(sourceRecord)).length;
    if (characters + size > maxCharacters) continue;
    result.push(...row); characters += size;
  }
  return result.sort((a, b) => parsed.sources.indexOf(a) - parsed.sources.indexOf(b));
}
