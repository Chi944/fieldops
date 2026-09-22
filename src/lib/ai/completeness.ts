import type { FieldValue, ParsedDocument, Quotation, ReviewIssue, SourceSpan } from "../domain/types";

type NumericDetail = "quantity" | "unitPrice" | "lineAmount";
const names: Record<NumericDetail, string> = { quantity: "quantity", unitPrice: "unit price or rate", lineAmount: "line amount" };
const numericPrefix = /^(?:[A-Z]{3}\s*)?[$€£¥]?\s*[-+]?\d/;
const interpreted = (field: FieldValue) => field.state === "value" || field.state === "ambiguous";

function rows(sources: SourceSpan[]): SourceSpan[][] {
  const groups = new Map<string, SourceSpan[]>();
  for (const source of sources) {
    const row = source.cell?.match(/\d+$/)?.[0];
    const key = source.kind === "sheet" && row ? `sheet:${source.sheet}:${row}`
      : source.kind === "pdf_text" && source.box ? `pdf:${source.page}:${Math.round(source.box.y / 3)}` : `source:${source.id}`;
    const group = groups.get(key) ?? []; group.push(source); groups.set(key, group);
  }
  return [...groups.values()];
}
function columnKind(text: string): NumericDetail | null {
  const header = text.trim().toLowerCase().replace(/[():]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:qty|quantity)(?:\s|$)/.test(header)) return "quantity";
  if (/^(?:unit (?:price|rate)|hourly rate|rate)(?:\s|$)/.test(header)) return "unitPrice";
  if (/^(?:line (?:amount|total)|extended (?:amount|price)|amount|total)(?:\s|$)/.test(header)) return "lineAmount";
  return null;
}
function explicitDetails(text: string): NumericDetail[] {
  const result: NumericDetail[] = [];
  const labels: [NumericDetail, RegExp][] = [
    ["quantity", /\b(?:quantity|qty)\s*[:=]?\s*/gi],
    ["unitPrice", /\b(?:unit\s*(?:price|rate)|hourly\s*rate)\s*[:=]?\s*/gi],
    ["lineAmount", /\b(?:line\s*(?:amount|total)|extended\s*(?:amount|price))\s*[:=]?\s*/gi],
  ];
  for (const [key, label] of labels) if ([...text.matchAll(label)].some(match => {
    const prefix = text.slice(0, match.index);
    if (key === "quantity" && /\b(?:minimum(?:\s+order)?|maximum(?:\s+order)?|min\.?\s+order|pack(?:age)?)\s*$/i.test(prefix)) return false;
    return numericPrefix.test(text.slice(match.index! + match[0].length));
  })) result.push(key);
  // A bare amount on an explicitly priced item row is distinguishable from a
  // quotation total. A standalone "Amount" line remains intentionally unknown.
  if (!result.includes("lineAmount") && result.includes("quantity") && result.includes("unitPrice") && [...text.matchAll(/\bamount\s*[:=]?\s*/gi)].some(match => numericPrefix.test(text.slice(match.index! + match[0].length)))) result.push("lineAmount");
  return result;
}

/** Conservative source-accounting guard, not a universal fact detector.
 * Only visibly labelled numbers or numeric cells beneath recognized headers
 * require interpretation. Value/ambiguous evidence may satisfy a detail; an
 * unsourced not-stated template cannot. No supplier values are changed.
 * Retained tier/charge evidence exempts that row. This guard does not establish
 * correct item-versus-charge classification, distinguish repeated facts within
 * one parser row, or prove that unlabelled values were completely interpreted.
 */
export function extractionCompletenessIssues(quotation: Quotation, parsed: ParsedDocument): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const headers = new Map<string, Map<string, NumericDetail>>();
  const evidence = new Map<NumericDetail, Set<string>>(["quantity", "unitPrice", "lineAmount"].map(key => [key as NumericDetail, new Set<string>()]));
  for (const item of quotation.items) for (const key of evidence.keys()) if (interpreted(item[key])) item[key].sourceIds.forEach(id => evidence.get(key)!.add(id));
  const chargeEvidence = new Set(quotation.charges.filter(charge => interpreted(charge.amount)).flatMap(charge => charge.amount.sourceIds));
  const tierEvidence = new Set(quotation.items.flatMap(item => item.tiers.flatMap(tier => tier.sourceIds)));
  const totalEvidence = new Set([quotation.statedSubtotal, quotation.statedTotal].filter(interpreted).flatMap(field => field.sourceIds));
  for (const row of rows(parsed.sources)) {
    const text = row.map(source => source.text).join(" ").trim();
    if (/^(?:sub\s*total|grand total|quoted total|total amount|shipping|freight|tax\b|vat\b|gst\b|payment\b)/i.test(text)) continue;
    const required = new Map<NumericDetail, string[]>();
    if (row[0]?.kind === "sheet") {
      const sheet = row[0].sheet ?? "";
      const detected = new Map<string, NumericDetail>();
      for (const source of row) { const kind = columnKind(source.text), column = source.cell?.match(/^[A-Z]+/i)?.[0]; if (kind && column) detected.set(column, kind); }
      if (detected.size >= 2 && row.every(source => !numericPrefix.test(source.text.trim()))) { headers.set(sheet, detected); continue; }
      const header = headers.get(sheet);
      if (header) for (const source of row) {
        const key = header.get(source.cell?.match(/^[A-Z]+/i)?.[0] ?? "");
        if (key && numericPrefix.test(source.text.trim())) required.set(key, [...(required.get(key) ?? []), source.id]);
      }
      // Vertically arranged spreadsheet cells can carry their own labels.
      for (const source of row) for (const key of explicitDetails(source.text)) required.set(key, [...(required.get(key) ?? []), source.id]);
    } else for (const key of explicitDetails(text)) required.set(key, row.map(source => source.id));
    // A bare Total footer can sit beneath the line-amount column. Require its
    // sole numeric cell to be retained as a quotation total; a Total-named item
    // with quantity/rate details, or evidence from another row, is not exempt.
    if (row[0]?.kind === "sheet" && /^total\s*:?$/i.test(row[0].text.trim()) && required.size === 1 && required.has("lineAmount")) {
      const numericCells = row.filter(source => numericPrefix.test(source.text.trim()));
      if (numericCells.length === 1 && required.get("lineAmount")!.includes(numericCells[0].id) && totalEvidence.has(numericCells[0].id)) continue;
    }
    // The charge schema represents the stated charge amount, without pretending
    // that its incidental quantity/rate is an item. Classification is separately
    // assessed by expected item coverage in the development quality audit.
    if (row.some(source => chargeEvidence.has(source.id) || tierEvidence.has(source.id))) continue;
    for (const [key, sourceIds] of required) {
      if (sourceIds.some(id => evidence.get(key)!.has(id))) continue;
      issues.push({ id: `${quotation.id}:explicit-detail:${key}:${sourceIds[0]}`, code: "incomplete_extraction", severity: "error", documentId: parsed.documentId,
        message: `The source explicitly states a numeric ${names[key]}, but no source-linked interpretation of that detail was retained. Review the highlighted source and enter or clarify the value.`, sourceIds: [...new Set(sourceIds)], resolved: false });
    }
  }
  return issues;
}
