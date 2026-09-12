import { createHash } from "node:crypto";
import path from "node:path";
import { LIMITS, type ParsedDocument, type SourceSpan, type CoverageUnit } from "../domain/types";
import { bounded, checkCancelled, ProcessingError, progress, type ProgressOptions } from "./errors";
export * from "./errors";
export { prepareOcrData } from "./ocr";

export interface ParseDocumentInput extends ProgressOptions { documentId: string; filename: string; bytes?: Uint8Array; text?: string; }
const VERSION = "fieldops-parsers-1";
const zipMagic = [0x50, 0x4b, 0x03, 0x04];
function begins(bytes: Uint8Array, magic: number[]): boolean { return magic.every((value, index) => bytes[index] === value); }
function fail(code: "unsupported_format" | "malformed_file" | "limit_exceeded", message: string): never { throw new ProcessingError(code, message); }
function excelColumn(index: number): string { let result = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
function safeText(bytes: Uint8Array): string { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("unsupported_format", "Text and CSV files must be UTF-8 encoded. Export a UTF-8 copy and upload it again."); } }

/** Reject oversized or encrypted archives before ExcelJS decompresses them. */
export function inspectXlsxArchive(bytes: Uint8Array): void {
  const data = Buffer.from(bytes); let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (data.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) fail("malformed_file", "This XLSX archive is damaged. Re-save it as XLSX or export its sheets as CSV.");
  const count = data.readUInt16LE(end + 10); let offset = data.readUInt32LE(end + 16); let expanded = 0;
  if (count > 2000 || count === 65535) fail("limit_exceeded", "This workbook contains too many archive entries. Upload a smaller workbook.");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) fail("malformed_file", "The workbook archive directory is damaged.");
    if (data.readUInt16LE(offset + 8) & 1) throw new ProcessingError("password_protected", "This workbook is encrypted. Upload an unlocked copy.");
    const packed = data.readUInt32LE(offset + 20); const unpacked = data.readUInt32LE(offset + 24); expanded += unpacked;
    if (unpacked > 50 * 1024 * 1024 || expanded > 100 * 1024 * 1024 || unpacked / Math.max(packed, 1) > 300) fail("limit_exceeded", "This workbook expands beyond the safe processing limit. Export the quotation sheets to CSV.");
    offset += 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
}

export async function parseDocument(input: ParseDocumentInput): Promise<ParsedDocument> {
  await progress(input, "validating", 5, "Checking format and document limits");
  if (!input.documentId || !input.filename) fail("malformed_file", "A document identifier and filename are required.");
  const bytes = input.text !== undefined ? new TextEncoder().encode(input.text) : input.bytes;
  if (!bytes?.length) fail("malformed_file", "The file is empty. Upload a quotation containing readable content.");
  if (bytes.length > LIMITS.fileBytes) throw new ProcessingError("file_too_large", `The file exceeds ${LIMITS.fileBytes / 1024 / 1024} MB. Split it into smaller quotations.`);
  const extension = path.extname(input.filename).toLowerCase();
  let format = input.text !== undefined ? "text" : extension.slice(1);
  if (begins(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const data = Buffer.from(bytes);
    if (data.includes(Buffer.from("EncryptedPackage", "utf16le")) || data.includes(Buffer.from("EncryptionInfo", "utf16le"))) throw new ProcessingError("password_protected", "This Office document is password protected. Upload an unlocked XLSX or CSV copy.");
    fail("unsupported_format", "Legacy XLS and other compound Office formats are not supported. Save the quotation as XLSX or CSV.");
  }
  if (!["text", "txt", "pdf", "xlsx", "csv", "png", "jpg", "jpeg"].includes(format)) fail("unsupported_format", "Supported inputs: PDF, PNG, JPEG, XLSX, UTF-8 CSV, and pasted text. Export this quotation to PDF or paste its text.");
  if (format === "pdf" && !Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) fail("malformed_file", "The file does not contain a PDF signature. Re-export the original quotation.");
  if (format === "xlsx" && !begins(bytes, zipMagic)) fail("malformed_file", "The file is not a valid XLSX workbook. Re-save it from your spreadsheet application.");
  if (format === "png" && !begins(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) fail("malformed_file", "This file is not a PNG image.");
  if (["jpg", "jpeg"].includes(format) && !begins(bytes, [0xff, 0xd8, 0xff])) fail("malformed_file", "This file is not a JPEG image.");
  if (format === "txt") format = "text";
  const result: ParsedDocument = { documentId: input.documentId, filename: input.filename, format, contentHash: createHash("sha256").update(bytes).digest("hex"), sources: [], manifest: { parserVersion: VERSION, units: [], complete: false, warnings: [] } };
  await progress(input, "parsing", 10, "Reading source content and locations");
  if (format === "text") parseText(result, input.text ?? safeText(bytes));
  else if (format === "csv") await parseCsv(result, safeText(bytes));
  else if (format === "xlsx") await parseXlsx(result, bytes, input);
  else if (format === "pdf") await parsePdf(result, bytes, input);
  else await parseImage(result, bytes, input);
  result.manifest.complete = result.manifest.units.every(unit => unit.status === "parsed" || unit.status === "empty") && result.sources.length > 0;
  if (result.sources.reduce((sum, source) => sum + source.text.length, 0) > LIMITS.textChars) fail("limit_exceeded", `This quotation exceeds ${LIMITS.textChars.toLocaleString()} extracted characters. Upload fewer pages or sheets.`);
  if (!result.sources.length && !result.manifest.units.some(unit => unit.status === "failed")) throw new ProcessingError("unreadable", "No readable quotation text was found. Upload a clearer printed scan, a text-based PDF, or paste the quotation text.");
  await progress(input, "parsing", 35, result.manifest.complete ? "Source content ready for extraction" : "Some source sections could not be read; review will be required");
  return result;
}

function parseText(result: ParsedDocument, text: string): void {
  if (text.length > LIMITS.textChars) fail("limit_exceeded", `Pasted text is limited to ${LIMITS.textChars.toLocaleString()} characters.`);
  if (text.includes("\0")) fail("malformed_file", "This text file contains binary content. Upload a UTF-8 text export.");
  result.originalText = text;
  let start = 0;
  for (const line of text.split(/(?<=\n)/)) { if (line.trim()) result.sources.push({ id: `${result.documentId}:text:${start}`, documentId: result.documentId, kind: "text", text: line.replace(/[\r\n]+$/, ""), start, end: start + line.replace(/[\r\n]+$/, "").length }); start += line.length; }
  result.manifest.units.push({ id: "text", label: "Quotation text", status: result.sources.length ? "parsed" : "empty", sourceCount: result.sources.length });
}

async function parseCsv(result: ParsedDocument, text: string): Promise<void> {
  if (text.length > LIMITS.textChars) fail("limit_exceeded", "This CSV exceeds the text processing limit. Export a smaller quotation table.");
  const { parse } = await import("csv-parse/sync");
  const candidates: { delimiter: string; width: number; rows: string[][] }[] = [];
  for (const delimiter of [",", ";", "\t", "|"]) {
    try { const rows = parse(text, { delimiter, bom: true, cast: false, skip_empty_lines: false, max_record_size: LIMITS.textChars }) as string[][];
      const width = Math.max(0, ...rows.map(row => row.length)); if (rows.length) candidates.push({ delimiter, width, rows });
    } catch { /* The other supported delimiters can still parse a legitimate file. */ }
  }
  candidates.sort((a, b) => b.width - a.width);
  if (!candidates.length) fail("malformed_file", "This CSV has malformed quoting or inconsistent columns. Export a well-formed UTF-8 CSV and upload it again.");
  const chosen = candidates[0];
  let quoted = false; let unquotedDelimiter = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"') { if (quoted && text[index + 1] === '"') index++; else quoted = !quoted; }
    else if (!quoted && [",", ";", "\t", "|"].includes(text[index])) unquotedDelimiter = true;
  }
  if (chosen.width === 1 && unquotedDelimiter) fail("malformed_file", "This CSV has inconsistent columns for its apparent delimiter. Export a well-formed UTF-8 CSV; rows were not silently flattened.");
  if (candidates[1]?.width === chosen.width && chosen.width > 1) fail("malformed_file", "The CSV delimiter is ambiguous. Export it as comma-separated UTF-8 CSV.");
  result.originalText = text;
  let count = 0;
  for (let row = 0; row < chosen.rows.length; row++) for (let column = 0; column < chosen.rows[row].length; column++) {
    const value = chosen.rows[row][column]; if (!value.trim()) continue;
    if (++count > LIMITS.populatedCells) fail("limit_exceeded", "This CSV has too many populated cells. Export only the quotation table.");
    const cell = `${excelColumn(column)}${row + 1}`;
    result.sources.push({ id: `${result.documentId}:csv:${cell}`, documentId: result.documentId, kind: "sheet", sheet: "CSV", cell, text: value });
  }
  result.manifest.units.push({ id: "csv", label: "CSV (logical records)", status: count ? "parsed" : "empty", sourceCount: count });
  result.manifest.warnings.push(`CSV delimiter: ${chosen.delimiter === "\t" ? "tab" : chosen.delimiter}. Source row numbers identify logical records, including quoted multiline fields.`);
}

async function parseXlsx(result: ParsedDocument, bytes: Uint8Array, options: ProgressOptions): Promise<void> {
  inspectXlsxArchive(bytes);
  const ExcelJS = (await import("exceljs")).default; const workbook = new ExcelJS.Workbook();
  try { await bounded(workbook.xlsx.load(Buffer.from(bytes) as never), 30000, options.signal); }
  catch (error) { if (error instanceof ProcessingError) throw error; fail("malformed_file", "This workbook could not be read. Re-save it as XLSX or export the relevant sheets as CSV."); }
  if (workbook.worksheets.length > LIMITS.worksheets) fail("limit_exceeded", `This workbook exceeds ${LIMITS.worksheets} worksheets. Export only the quotation sheets.`);
  let count = 0;
  for (const sheet of workbook.worksheets) {
    checkCancelled(options.signal); const before = result.sources.length;
    if (sheet.state !== "visible") result.manifest.warnings.push(`Worksheet "${sheet.name}" is ${sheet.state}; its cells are included and labelled.`);
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      if (cell.value === null || cell.value === undefined) return;
      const formulaCell = typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value);
      if (cell.text === "" && !formulaCell) return;
      if (++count > LIMITS.populatedCells) fail("limit_exceeded", "This workbook contains too many populated cells. Export only the quotation table.");
      const value = cell.value;
      let text = cell.text;
      if (value instanceof Date) text = `${value.toISOString().slice(0, 10)} [Excel date; format: ${cell.numFmt}; ${workbook.properties.date1904 ? "1904" : "1900"} date system]`;
      else if (typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
        const cached = cell.result;
        text = `${cached === undefined || cached === null ? "[cached value unavailable]" : String(cached)} [formula: ${cell.formula}; cached result, not recalculated]`;
        if (cached === undefined || cached === null) result.manifest.warnings.push(`Formula result unavailable at ${sheet.name}!${cell.address}; open, recalculate, and save the workbook or enter the value manually.`);
      } else if (cell.numFmt && cell.numFmt !== "General") text += ` [number format: ${cell.numFmt}]`;
      result.sources.push({ id: `${result.documentId}:sheet:${sheet.id}:${cell.address}`, documentId: result.documentId, kind: "sheet", sheet: sheet.name, cell: cell.address, ...(cell.isMerged ? { mergedMaster: cell.master.address } : {}), text });
    }));
    result.manifest.units.push({ id: `sheet:${sheet.id}`, label: sheet.name, status: result.sources.length > before ? "parsed" : "empty", sourceCount: result.sources.length - before });
  }
}

async function parseImage(result: ParsedDocument, bytes: Uint8Array, options: ProgressOptions): Promise<void> {
  const sharp = (await import("sharp")).default;
  try {
    const meta = await sharp(bytes, { limitInputPixels: LIMITS.imagePixels }).metadata();
    if ((meta.pages ?? 1) > 1) fail("unsupported_format", "Animated or multi-frame images are not supported. Upload separate PNG/JPEG pages.");
    const normalized = await sharp(bytes, { limitInputPixels: LIMITS.imagePixels }).rotate().png().toBuffer({ resolveWithObject: true });
    const { recognizeImage } = await import("./ocr");
    const sources = await recognizeImage({ bytes: normalized.data, documentId: result.documentId, page: 1, width: normalized.info.width, height: normalized.info.height, signal: options.signal });
    result.sources.push(...sources);
    result.manifest.units.push({ id: "image:1", label: "Image", status: sources.length ? "parsed" : "failed", sourceCount: sources.length, ...(!sources.length ? { message: "No readable printed text; upload a clearer scan or paste text." } : {}) });
    result.manifest.warnings.push("OCR supports printed English. Review OCR values against the original image; image regions use the orientation-normalized rendition.");
    if (sources.some(source => (source.confidence ?? 100) < 65)) result.manifest.warnings.push("Low OCR confidence: some text may be incomplete or incorrect; verify highlighted regions.");
  } catch (error) { if (error instanceof ProcessingError) throw error; throw new ProcessingError("unreadable", "This image could not be decoded or exceeds the pixel limit. Upload a smaller, legible PNG/JPEG."); }
}

async function parsePdf(result: ParsedDocument, bytes: Uint8Array, options: ProgressOptions): Promise<void> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const resources = (folder: string) => `${path.join(process.cwd(), "node_modules/pdfjs-dist", folder).replaceAll("\\", "/")}/`;
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, stopAtErrors: true, useSystemFonts: true, maxImageSize: LIMITS.imagePixels, standardFontDataUrl: resources("standard_fonts"), cMapUrl: resources("cmaps"), cMapPacked: true });
  let passwordProtected = false;
  loading.onPassword = () => { passwordProtected = true; void loading.destroy(); };
  let document: Awaited<typeof loading.promise>;
  try { document = await bounded(loading.promise, 30000, options.signal, () => loading.destroy()); }
  catch (error) { if (passwordProtected) throw new ProcessingError("password_protected", "This PDF is password protected. Upload an unlocked copy."); if (error instanceof ProcessingError) throw error; if (error instanceof Error && /password/i.test(error.message)) throw new ProcessingError("password_protected", "This PDF is password protected. Upload an unlocked copy."); fail("malformed_file", "The PDF is damaged or cannot be read. Re-export it or upload page images."); }
  try {
    if (document.numPages > LIMITS.pdfPages) fail("limit_exceeded", `PDFs are limited to ${LIMITS.pdfPages} pages. Split the quotation into smaller files.`);
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      await progress(options, "parsing", 10 + Math.round(pageNumber / document.numPages * 20), `Reading page ${pageNumber} of ${document.numPages}`);
      const unit: CoverageUnit = { id: `page:${pageNumber}`, label: `Page ${pageNumber}`, status: "failed", sourceCount: 0 }; result.manifest.units.push(unit);
      try {
        const page = await bounded(document.getPage(pageNumber), 20000, options.signal); const viewport = page.getViewport({ scale: 1 });
        const content = await bounded(page.getTextContent({ disableNormalization: true }), 20000, options.signal);
        const textSources: SourceSpan[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const matrix = pdfjs.Util.transform(viewport.transform, item.transform); const style = content.styles[item.fontName];
          const height = Math.hypot(matrix[2], matrix[3]);
          const horizontal = Math.abs(matrix[1]) < 0.01 && Math.abs(matrix[2]) < 0.01;
          textSources.push({ id: `${result.documentId}:pdf:p${pageNumber}:t${textSources.length + 1}`, documentId: result.documentId, kind: "pdf_text", page: pageNumber, text: item.str, pageWidth: viewport.width, pageHeight: viewport.height, rotation: viewport.rotation,
            ...(horizontal ? { box: { x: matrix[4], y: Math.max(0, matrix[5] - height * (style?.ascent ?? 1)), width: Math.abs(item.width), height } } : {}) });
        }
        const textLength = textSources.reduce((sum, source) => sum + source.text.length, 0);
        const operations = await bounded(page.getOperatorList(), 20000, options.signal);
        const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);
        const hasImages = operations.fnArray.some(operation => imageOps.has(operation));
        // OCR all image-containing pages: a digital header must not hide a scanned table.
        if (hasImages || textLength < 30) {
          const scale = Math.min(2.5, Math.sqrt(LIMITS.imagePixels / (viewport.width * viewport.height))); const raster = page.getViewport({ scale });
          const factory = document.canvasFactory as { create(width: number, height: number): { canvas: { toBuffer(format: string): Buffer }; context: CanvasRenderingContext2D }; destroy(canvas: unknown): void };
          const canvas = factory.create(Math.ceil(raster.width), Math.ceil(raster.height));
          try {
            const render = page.render({ canvas: null, canvasContext: canvas.context, viewport: raster });
            await bounded(render.promise, 30000, options.signal, () => render.cancel());
            const { recognizeImage } = await import("./ocr");
            const ocr = await recognizeImage({ bytes: canvas.canvas.toBuffer("image/png"), documentId: result.documentId, page: pageNumber, width: raster.width, height: raster.height, signal: options.signal });
            // Keep native fragments; add OCR only where native text cannot account for it.
            const nativeText = textSources.map(source => source.text).join(" ").replace(/\s+/g, " ").toLowerCase();
            const additional = ocr.filter(source => !nativeText.includes(source.text.replace(/\s+/g, " ").toLowerCase()));
            result.sources.push(...textSources, ...additional);
            unit.sourceCount = textSources.length + additional.length;
            if (ocr.some(source => (source.confidence ?? 100) < 65)) result.manifest.warnings.push(`Page ${pageNumber}: low OCR confidence; verify the source before comparing amounts.`);
            if (!ocr.length && hasImages) { unit.status = "failed"; unit.message = "Image content could not be read; verify the page or upload a clearer scan."; }
            else unit.status = unit.sourceCount ? "parsed" : "empty";
          } finally { factory.destroy(canvas); }
        } else { result.sources.push(...textSources); unit.sourceCount = textSources.length; unit.status = textSources.length ? "parsed" : "empty"; }
        page.cleanup();
      } catch (error) {
        if (error instanceof ProcessingError && error.code === "cancelled") throw error;
        unit.status = "failed"; unit.message = error instanceof ProcessingError ? error.message : "This page could not be parsed. Upload a fresh PDF or page image.";
      }
    }
  } finally { await loading.destroy(); }
}
