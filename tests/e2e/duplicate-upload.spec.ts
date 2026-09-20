import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Comparison, ProcessingRun } from "../../src/lib/domain/types";

test("duplicate CSV opens the existing source and creates a separate copy only after an explicit click", async ({ page, request }) => {
  const status = await (await request.get("/api/status")).json();
  test.skip(status.mode !== "local", "Requires an isolated local parser-only workspace; never uploads to public or personal cloud data.");
  expect(status.canExtract).toBe(false);
  expect(status.processingMode).toBe("parse_only");
  const created = await request.post("/api/comparisons", { data: { name: `Duplicate upload regression ${Date.now()}` } });
  expect(created.status()).toBe(201);
  const { comparison } = await created.json() as { comparison: Comparison };
  const id = comparison.id;
  const uploadPath = `/api/comparisons/${id}/uploads`;
  const snapshot = async () => (await (await request.get(`/api/comparisons/${id}`)).json()) as { comparison: Comparison; runs: ProcessingRun[] };
  const text = "Supplier,Identifier,Description,Quantity,Unit,Unit price,Currency\nSynthetic Cedar,ARC-01,Archive wallets,2,each,12.50,USD\n";
  const file = { name: "synthetic-duplicate.csv", mimeType: "text/csv", buffer: Buffer.from(text) };
  let uploadRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === uploadPath) uploadRequests += 1;
  });
  try {
    await page.goto(`/comparisons/${id}/upload`);
    const input = page.getByLabel("Choose quotation files", { exact: true });
    await input.setInputFiles(file);
    await expect.poll(async () => (await snapshot()).comparison.quotations.filter(quote => quote.status === "source_ready").length).toBe(1);
    await expect(page.locator(".file-row")).toHaveCount(1);
    const original = (await snapshot()).comparison.quotations[0];

    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === uploadPath && response.status() === 409);
    await input.setInputFiles(file);
    const error = (await (await rejected).json()).error;
    expect(error.code).toBe("duplicate");
    expect(error.message).not.toMatch(/duplicate/i);
    expect(error.details.documentId).toBe(original.documentId);
    const recovery = page.locator(".file-row").filter({ has: page.getByRole("button", { name: "Upload separate copy", exact: true }) });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    const existing = recovery.getByRole("link", { name: "Open existing source", exact: true });
    await expect(existing).toHaveAttribute("href", `/api/documents/${original.documentId}/source`);
    expect((await snapshot()).comparison.quotations).toHaveLength(1);

    const download = page.waitForEvent("download");
    await existing.click();
    const originalDownload = await download;
    expect(await readFile((await originalDownload.path())!, "utf8")).toBe(text);
    expect((await snapshot()).comparison.quotations).toHaveLength(1);
    expect(uploadRequests).toBe(2);

    await recovery.getByRole("button", { name: "Upload separate copy", exact: true }).click();
    await expect.poll(async () => (await snapshot()).comparison.quotations.filter(quote => quote.status === "source_ready").length).toBe(2);
    await expect(page.locator(".file-row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Upload separate copy", exact: true })).toHaveCount(0);
    // File multipart bodies are not exposed reliably by Chromium's request
    // metadata. The actual 409 before the click and two persisted originals
    // afterwards verify intentional admission without replacing the transport.
    expect(uploadRequests).toBe(3);
    const final = await snapshot();
    expect(new Set(final.comparison.quotations.map(quote => quote.documentId)).size).toBe(2);
    expect(final.comparison.quotations.map(quote => quote.documentId)).toContain(original.documentId);
    expect(final.runs).toHaveLength(2);
    expect(final.runs.every(run => run.processingMode === "parse_only" && run.stage === "source_ready")).toBe(true);
    for (const quotation of final.comparison.quotations) {
      expect(await (await request.get(`/api/documents/${quotation.documentId}/source`)).text()).toBe(text);
    }
  } finally {
    expect((await request.delete(`/api/comparisons/${id}`)).ok()).toBe(true);
  }
});
