import { copyFile, mkdir } from "node:fs/promises";
await mkdir(new URL("../public", import.meta.url), { recursive: true });
await copyFile(
  new URL(
    "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ),
  new URL("../public/pdf.worker.min.mjs", import.meta.url),
);

await copyFile(new URL("../docs/evaluation-report.md", import.meta.url), new URL("../public/evaluation-report.md", import.meta.url));
await copyFile(new URL("../eval/results/latest.json", import.meta.url), new URL("../public/evaluation-results.json", import.meta.url));
