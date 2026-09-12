import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseDocument, prepareOcrData, ProcessingError } from "../src/lib/processing";
import { extractQuotation, requireLiveAI } from "../src/lib/ai";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--prepare-ocr")) { const installed = await prepareOcrData(); console.log(JSON.stringify({ ocrData: installed.path, sha256: installed.sha256 })); return; }
  const filename = args.find(arg => !arg.startsWith("--"));
  if (!filename) throw new Error("Usage: npx tsx scripts/process.ts <quotation.pdf|xlsx|csv|png|jpg|txt> [--live] [--output=path.json], or --prepare-ocr. Parsing does not call a model.");
  if (args.includes("--live")) requireLiveAI();
  const bytes = await readFile(filename);
  const options = { onProgress: (event: { stage: string; message: string }) => { console.error(`${event.stage}: ${event.message}`); } };
  const parsed = await parseDocument({ documentId: randomUUID(), filename: path.basename(filename), bytes, ...options });
  const result = args.includes("--live") ? await extractQuotation(parsed, options) : parsed;
  const output = args.find(arg => arg.startsWith("--output="))?.slice("--output=".length);
  if (output) { await writeFile(output, JSON.stringify(result, null, 2)); console.log(`Saved processing result to ${path.resolve(output)}`); }
  else console.log(JSON.stringify({ documentId: parsed.documentId, format: parsed.format, sourceCount: parsed.sources.length, manifest: parsed.manifest, liveExtraction: args.includes("--live") }, null, 2));
}
main().catch(error => { console.error(error instanceof ProcessingError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Processing failed."); process.exitCode = 1; });
