import { mkdir, access, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SourceSpan } from "../domain/types";
import { bounded, ProcessingError, checkCancelled } from "./errors";

export const OCR_DATA_URL = "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz";
export function ocrDataDirectory(): string { return process.env.FIELDOPS_OCR_DATA_DIR || path.join(process.cwd(), ".fieldops", "tessdata"); }
/** Setup-time download only; deployed workers must bundle this directory. */
export async function prepareOcrData(): Promise<{ path: string; sha256: string }> {
  const directory = ocrDataDirectory(); const target = path.join(directory, "eng.traineddata.gz");
  await mkdir(directory, { recursive: true });
  try { await access(target); }
  catch {
    const response = await fetch(OCR_DATA_URL, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new ProcessingError("unreadable", "Could not download the English OCR language data. Run OCR setup again.", true);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 100000 || data.length > 30 * 1024 * 1024 || data[0] !== 0x1f || data[1] !== 0x8b) throw new ProcessingError("malformed_file", "OCR language download was not a valid expected-size gzip file.");
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, data); try { await rename(temporary, target); } catch (error) { await unlink(temporary).catch(() => {}); try { await access(target); } catch { throw error; } }
  }
  const { readFile } = await import("node:fs/promises");
  return { path: target, sha256: createHash("sha256").update(await readFile(target)).digest("hex") };
}

export async function recognizeImage(input: { bytes: Uint8Array; documentId: string; page: number; width: number; height: number; signal?: AbortSignal }): Promise<SourceSpan[]> {
  checkCancelled(input.signal);
  const langPath = ocrDataDirectory();
  try { await access(path.join(langPath, "eng.traineddata.gz")); }
  catch { throw new ProcessingError("unreadable", "English OCR data is not installed. Run `npx tsx scripts/process.ts --prepare-ocr` and bundle .fieldops/tessdata with the worker."); }
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { langPath, cacheMethod: "none", gzip: true, logger: () => {} });
  try {
    const result = await bounded(worker.recognize(Buffer.from(input.bytes), {}, { text: true, blocks: true }), 90000, input.signal, () => worker.terminate());
    const sources: SourceSpan[] = [];
    for (const block of result.data.blocks ?? []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) {
      const text = line.text.trim(); if (!text) continue;
      const box = line.bbox;
      sources.push({ id: `${input.documentId}:ocr:p${input.page}:l${sources.length + 1}`, documentId: input.documentId, kind: "ocr", page: input.page, text,
        pageWidth: input.width, pageHeight: input.height, rotation: 0, confidence: line.confidence,
        box: { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 } });
    }
    return sources;
  } finally { await worker.terminate().catch(() => {}); }
}
