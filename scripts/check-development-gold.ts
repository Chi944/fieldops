import { readFile, mkdir, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { Decimal } from "decimal.js";
import type { Quotation, FieldValue } from "../src/lib/domain/types";

const selected = ["industrial-1", "translation-2", "office-2"] as const;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function decimal(raw: string) {
  let value = raw.trim().replace(/[\s\u00a0']/g, "");
  if (value.includes(",") && value.includes(".")) value = value.lastIndexOf(",") > value.lastIndexOf(".") ? value.replaceAll(".", "").replace(",", ".") : value.replaceAll(",", "");
  else if (value.includes(",")) value = /,\d{3}(?:,|$)/.test(value) ? value.replaceAll(",", "") : value.replace(",", ".");
  return new Decimal(value);
}

/** Independent label-based check for this fixed authored cohort; not a universal document parser. */
export function auditNumericRows(quotation: Quotation, text: string) {
  const compact = text.replace(/\s+/g, " ");
  const counts = { items: quotation.items.length, quantity: { checked: 0, matched: 0 }, unitPrice: { checked: 0, matched: 0 }, minimumOrder: { statedChecked: 0, statedMatched: 0, notStatedChecked: 0, notStatedMatched: 0 } };
  const failures: string[] = [];
  for (const [index, item] of quotation.items.entries()) {
    const identifier = item.identifier.value;
    if (!identifier) { failures.push(`row-${index + 1}:identifier`); continue; }
    const marker = new RegExp(`\\bID\\s+${escape(identifier)}(?=\\s|[|;]|$)`, "i").exec(compact);
    if (!marker) { failures.push(`row-${index + 1}:identifier`); continue; }
    const following = compact.slice(marker.index + marker[0].length);
    const next = following.search(/\bID\s+[A-Za-z0-9_-]+/i);
    const segment = next >= 0 ? following.slice(0, next) : following;
    const number = "([-+]?\\d[\\d.,]*)";
    const compare = (field: FieldValue, raw: string | undefined) => raw !== undefined && field.state === "value" && field.value !== null && decimal(raw).equals(new Decimal(field.value));
    for (const [key, label] of [["quantity", "quantity"], ["unitPrice", "unit price"]] as const) {
      counts[key].checked++;
      const raw = new RegExp(`${label}\\s+(?:[A-Z]{3}\\s+)?${number}`, "i").exec(segment)?.[1];
      if (compare(item[key], raw)) counts[key].matched++; else failures.push(`row-${index + 1}:${key}`);
    }
    const moq = /\b(?:MOQ|minimum order(?: quantity)?)\s*[:=]?\s*([-+]?\d[\d.,]*)/i.exec(segment)?.[1];
    if (item.minimumOrder.state === "value") {
      counts.minimumOrder.statedChecked++;
      if (compare(item.minimumOrder, moq)) counts.minimumOrder.statedMatched++; else failures.push(`row-${index + 1}:minimumOrder`);
    } else if (item.minimumOrder.state === "not_stated") {
      counts.minimumOrder.notStatedChecked++;
      if (moq === undefined) counts.minimumOrder.notStatedMatched++; else failures.push(`row-${index + 1}:minimumOrder-not-stated`);
    } else failures.push(`row-${index + 1}:unsupported-minimumOrder-state`);
  }
  return { ...counts, failures, passed: !failures.length };
}

export async function checkDevelopmentGold(root = process.cwd()) {
  root = await realpath(root);
  const manifestPath = path.join(root, "eval/development/gold.json");
  if (await realpath(manifestPath) !== manifestPath) throw new Error("The development manifest must not redirect to another file.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { split: string; documents: { id: string; split: string; path: string; sha256: string; quotation: Quotation }[] };
  if (manifest.split !== "dev" || !Array.isArray(manifest.documents) || manifest.documents.some(doc => doc.split !== "dev")) throw new Error("A development-only manifest is required.");
  const documents = [];
  for (const id of selected) {
    const matches = manifest.documents.filter(doc => doc.id === id);
    if (matches.length !== 1) throw new Error("The fixed development cohort must be present exactly once.");
    const fixture = matches[0];
    if (fixture.quotation.items.length !== 6) throw new Error("This audit expects the fixed six-item authored originals.");
    const extension = id === "industrial-1" ? "pdf" : id === "office-2" ? "csv" : "txt";
    const filename = path.join(root, "eval/originals/dev", `${id}.${extension}`);
    if (path.resolve(root, fixture.path) !== filename) throw new Error("A selected original has an unexpected path.");
    if (await realpath(filename) !== filename) throw new Error("A selected original must not redirect to another file.");
    const bytes = await readFile(filename);
    if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) throw new Error("A selected original does not match its frozen hash.");
    let text = "";
    if (extension === "pdf") {
      const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = pdf.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true });
      const document = await task.promise;
      try {
        for (let page = 1; page <= document.numPages; page++) {
          const content = await (await document.getPage(page)).getTextContent();
          text += content.items.filter((item): item is typeof item & { str: string } => "str" in item).map(item => item.str).join("\n") + "\n";
        }
      } finally { await task.destroy(); }
    } else if (extension === "csv") text = (parse(bytes, { bom: true }) as string[][]).slice(1).map(row => row[1]).join("\n");
    else text = bytes.toString("utf8");
    documents.push({ documentId: id, originalHashVerified: true, ...auditNumericRows(fixture.quotation, text) });
  }
  const totals = documents.reduce((sum, doc) => ({ quantities: sum.quantities + doc.quantity.checked, prices: sum.prices + doc.unitPrice.checked, statedMoq: sum.statedMoq + doc.minimumOrder.statedChecked, absentMoq: sum.absentMoq + doc.minimumOrder.notStatedChecked }), { quantities: 0, prices: 0, statedMoq: 0, absentMoq: 0 });
  const expectedScope = totals.quantities === 18 && totals.prices === 18 && totals.statedMoq === 3 && totals.absentMoq === 15;
  return {
    checkedAt: new Date().toISOString(), auditCodePath: "scripts/check-development-gold.ts", auditCodeSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"), documents, totals, expectedScope, passed: expectedScope && documents.every(document => document.passed),
    method: "Independent label-based numeric audit of exactly three authored original files against development-only gold. PDF text is decoded directly with PDF.js, CSV content records with csv-parse, and the text file as UTF-8; no application extraction or model is invoked. Gold item identifiers align rows; the original Quantity, Unit price and MOQ labels supply numerical values.",
    limitations: ["Not a human visual review or full semantic gold validation.", "Shares PDF.js and csv-parse libraries with the application, but does not call its parsing or AI extraction code.", "Only 18 quantities, 18 unit prices, three stated minimum orders and 15 absent minimum orders are checked. Description, scope, commercial terms, currency, units, totals and matching labels are outside this audit.", "The label and row-boundary rules are deliberately limited to these authored originals; they are not a general quotation interpreter.", "Reads the separate development gold and three fixed development originals only. No held-out original or combined gold file is read."],
  };
}

async function main() {
  if (process.argv.length > 2) throw new Error("This audit accepts no dataset or path overrides.");
  const report = await checkDevelopmentGold();
  const directory = path.join(process.cwd(), "eval/results/development/gold-audits");
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory) throw new Error("The audit directory must not redirect outside its fixed path.");
  const filename = path.join(directory, `${report.checkedAt.replace(/[:.]/g, "-")}.json`);
  const handle = await open(filename, "wx");
  try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify({ passed: report.passed, totals: report.totals, documentCount: report.documents.length, failures: report.documents.reduce((sum, document) => sum + document.failures.length, 0), report: path.relative(process.cwd(), filename).replaceAll("\\", "/") }));
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.error("Selected development gold audit stopped. No source contents or credentials disclosed."); process.exitCode = 1; });
