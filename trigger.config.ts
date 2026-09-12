import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID || "unconfigured-fieldops",
  runtime: "node",
  dirs: ["./src/trigger"],
  maxDuration: 600,
  machine: "medium-1x",
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
  build: {
    external: ["pdfjs-dist", "@napi-rs/canvas", "sharp", "tesseract.js", "exceljs"],
    extensions: [additionalFiles({ files: ["./.fieldops/tessdata/**"] })],
  },
});
