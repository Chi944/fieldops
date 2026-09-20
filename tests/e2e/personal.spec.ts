import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import AxeBuilder from "@axe-core/playwright";
import type { Comparison, ProcessingRun } from "../../src/lib/domain/types";

async function correct(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: `Correct ${label}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Correct ${label.toLowerCase()}`, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Value state", exact: true }).selectOption("value");
  await dialog.getByLabel("Corrected value", { exact: true }).fill(value);
  await dialog.getByLabel("Reason for correction", { exact: true }).fill("Manually read and verified against the complete original quotation.");
  await dialog.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("personal quotations persist separately from samples through manual review, comparison and export", async ({ page, request }, testInfo) => {
  page.setDefaultTimeout(12_000);
  const status = await (await request.get("/api/status")).json();
  test.skip(status.mode !== "local", "Requires the isolated local personal workspace; public demos cannot receive private files.");
  expect(status.canExtract, "This test must never call a model").toBe(false);
  expect(status.processingMode).toBe("parse_only");
  expect(status.canUpload).toBe(true);
  await page.goto("/");
  await expect(page.locator(".workspace-switch")).toContainText("Local workspace");
  await expect(page.locator(".workspace-switch")).toContainText("Saved on this computer");
  await expect(page.getByRole("heading", { name: "Your quotation workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Workspace status", exact: true }).click();
  const diagnostics = page.getByRole("dialog", { name: "Workspace status", exact: true });
  await expect(diagnostics.getByText("Manual source review", { exact: true })).toBeVisible();
  await expect(diagnostics.getByRole("region", { name: "Processing queue" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await diagnostics.getByRole("button", { name: "Done", exact: true }).click();
  await expect(diagnostics).toBeHidden();
  await expect(page.locator(".comparison-list-row").filter({ hasText: "Studio equipment & installation" })).toHaveCount(0);
  await page.getByRole("button", { name: "New comparison", exact: true }).first().click();
  const create = page.getByRole("dialog", { name: "Start a comparison", exact: true });
  const name = `Personal document supplies ${Date.now()}`;
  await create.getByLabel("Comparison name", { exact: true }).fill(name);
  await expect(create).toContainText("saved on this computer");
  await create.getByRole("button", { name: "Create comparison", exact: true }).click();
  await expect(page).toHaveURL(/\/comparisons\/[^/]+\/upload$/);
  const id = new URL(page.url()).pathname.split("/")[2];
  const snapshot = async () => (await (await request.get(`/api/comparisons/${id}`)).json()) as { comparison: Comparison; runs: ProcessingRun[] };
  const quotes = [
    { filename: "cedar.txt", supplier: "Cedar Office Supply", price: "12.50", amount: "25.00" },
    { filename: "harbor.txt", supplier: "Harbor Document Supplies", price: "11.25", amount: "22.50" },
  ].map((quote, index) => ({ ...quote, text: `Supplier: ${quote.supplier}\nQuotation: PERSONAL-${index + 1}\nDate: 13 September 2026\nCurrency: USD\nItem: Archive wallets | Quantity: 2 each | Unit price: USD ${quote.price} | Line amount: USD ${quote.amount} | Prices exclude tax; tax rate: 0%\nDelivery cost is not stated. Payment: 30 days from invoice.\nSelf-authored synthetic quotation for personal-workspace acceptance.` }));
  try {
    await expect(page.getByRole("button", { name: "Add samples", exact: true })).toHaveCount(0);
    await expect(page.locator(".upload-method-note")).toContainText("No AI model is called");
    await page.getByLabel("Choose quotation files", { exact: true }).setInputFiles(quotes.map(quote => ({ name: quote.filename, mimeType: "text/plain", buffer: Buffer.from(quote.text) })));
    await expect.poll(async () => (await snapshot()).comparison.quotations.filter(quote => quote.status === "source_ready").length, { timeout: 30_000 }).toBe(2);
    const parsed = await snapshot();
    expect(parsed.comparison.isDemo).toBe(false);
    expect(parsed.runs.every(run => run.processingMode === "parse_only" && run.stage === "source_ready" && !run.errorCode)).toBe(true);
    expect(parsed.comparison.quotations.every(quote => quote.extractionVersion === 0 && quote.items.length === 0 && quote.sources.length > 0)).toBe(true);
    await page.reload();
    await expect(page.locator(".file-row")).toHaveCount(2);
    await expect(page.locator(".file-row").first()).toContainText("Source ready");

    for (const fixture of quotes) {
      const quotation = (await snapshot()).comparison.quotations.find(quote => quote.filename === fixture.filename)!;
      const original = await request.get(`/api/documents/${quotation.documentId}/source`);
      expect(await original.text()).toBe(fixture.text);
      const source = quotation.sources.find(source => source.text.includes("Item: Archive wallets"))!;
      expect(source).toBeDefined();
      await page.goto(`/comparisons/${id}/review?q=${encodeURIComponent(quotation.id)}`);
      await expect(page.getByText("Source ready for your review", { exact: true })).toBeVisible();
      await expect(page.locator(".manual-review-notice").getByRole("button", { name: "Confirm manual review", exact: true })).toBeDisabled();
      // Entering the supplier first must not leave an obsolete no-items issue
      // after the buyer subsequently enters all source rows.
      await correct(page, "Supplier name", fixture.supplier);
      await correct(page, "Original currency", "USD");
      await page.getByRole("button", { name: "Add an item", exact: true }).click();
      const add = page.getByRole("dialog", { name: "Add a missing item", exact: true });
      await add.getByLabel("Item description", { exact: true }).fill("Archive wallets");
      await add.getByLabel("Quantity", { exact: true }).fill("2");
      await add.getByLabel("Unit", { exact: true }).fill("each");
      await add.getByLabel("Unit price", { exact: true }).fill(fixture.price);
      await add.getByLabel("Currency", { exact: true }).fill("USD");
      await add.getByRole("combobox", { name: "Tax basis", exact: true }).selectOption("exclusive");
      await add.getByLabel("Explicit tax rate (%)", { exact: true }).fill("0");
      await add.getByLabel(/Source evidence \(optional\)/).selectOption([source.id]);
      await add.getByRole("textbox", { name: "Review note", exact: true }).fill("Entered the one stated line from the selected original excerpt; delivery remains unknown.");
      await add.getByRole("button", { name: "Add item", exact: true }).click();
      await expect(add).toBeHidden();
      await page.locator(".manual-review-notice").getByRole("button", { name: "Confirm manual review", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "Confirm manual review", exact: true });
      await confirmation.getByLabel("Review reason", { exact: true }).fill("Checked every original source line, entered the only item and supplier, and reviewed payment and unstated delivery. No AI interpretation was used.");
      await confirmation.getByRole("button", { name: "Confirm manual review", exact: true }).click();
      await expect(confirmation).toBeHidden();
      await expect.poll(async () => (await snapshot()).comparison.quotations.find(quote => quote.id === quotation.id)?.status).toBe("ready");
    }

    await page.getByRole("navigation", { name: "Comparison workflow" }).getByRole("link", { name: /Item matching/ }).click();
    await page.getByRole("button", { name: "Refresh baseline", exact: true }).click();
    await expect(page.locator(".match-group")).toHaveCount(1);
    await page.getByRole("button", { name: "Approve equivalence", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approved", exact: true })).toBeDisabled();
    await page.getByRole("link", { name: "Open comparison", exact: true }).click();
    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: "Archive wallets" }) });
    await expect(row).toContainText("$25.00");
    await expect(row).toContainText("$22.50");
    await expect(row).toContainText("Match reviewed");
    await expect(page.getByText("No overall supplier winner: coverage or costs are incomplete.", { exact: true })).toBeVisible();
    const reviewed = (await snapshot()).comparison;
    expect(reviewed.quotations.every(quote => quote.extractionVersion === 0 && quote.items[0].unitPrice.origin === "user" && quote.items[0].sourceIds.length === 1)).toBe(true);
    expect(reviewed.corrections.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fieldops-demo-v1") ?? "[]").some((comparison: { id: string }) => comparison.id === new URL(location.href).pathname.split("/")[2]))).toBe(false);

    await page.getByRole("navigation", { name: "Comparison workflow" }).getByRole("link", { name: /Export report/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Excel", exact: true }).click();
    const downloaded = await downloadPromise;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile((await downloaded.path())!);
    expect(workbook.getWorksheet("Reviewed items")!.rowCount).toBe(3);
    expect(workbook.getWorksheet("Corrections")!.rowCount).toBeGreaterThan(2);
    expect(workbook.getWorksheet("Sources")!.rowCount).toBeGreaterThan(2);
    await page.reload();
    await expect(page.locator(".report-title")).toContainText(name);
    await page.evaluate(() => { window.print = () => document.body.setAttribute("data-test-printed", "true"); });
    await page.getByRole("button", { name: "Print / save PDF", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-test-printed", "true");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".print-report")).toBeVisible();
    const pdf = await page.pdf({ path: testInfo.outputPath("personal-decision-report.pdf"), printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    await page.emulateMedia({ media: "screen" });
  } finally {
    const response = await request.delete(`/api/comparisons/${id}`);
    expect(response.ok()).toBe(true);
  }
});
