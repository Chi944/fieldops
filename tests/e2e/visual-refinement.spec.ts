import { expect, test } from "@playwright/test";

test("workspace review queue preserves issue provenance through loading, empty and narrow layouts", async ({ page }) => {
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>(resolve => { releaseStatus = resolve; });
  await page.route("**/api/status", async route => {
    await statusGate;
    await route.fulfill({ json: { mode: "demo", authenticated: false, canPersist: false, canUpload: false, canExtract: false, processingMode: "parse_only", reasons: [] } });
  });
  // Browser-only fixtures exercise the UI. A visual test must never upload or
  // mutate records in the developer's running personal workspace.
  await page.route("**/api/**", async route => {
    if (route.request().url().endsWith("/api/status")) return route.fallback();
    expect(["GET", "HEAD"]).toContain(route.request().method());
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Opening your workspace", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-create")).toBeDisabled();
  releaseStatus();
  await expect(page.getByRole("heading", { name: "Your quotation workspace", exact: true })).toBeVisible();
  const issues = page.locator(".welcome-review-list > a");
  await expect(issues).toHaveCount(2);
  await expect(issues.first()).toContainText("Supplier line amount 116 differs from calculated 104.00 by 12.00.");
  await expect(issues.first()).toHaveAttribute("href", "/comparisons/demo-studio/review?q=meridian");
  await issues.first().click();
  await expect(page.getByLabel("Reviewing", { exact: true })).toHaveValue("meridian");
  await page.getByRole("button", { name: "Review next issue", exact: true }).click();
  await expect(page.locator(".source-line.highlighted")).toHaveAttribute("id", "source-meridian-cable");
  await expect(page.locator(".source-line.highlighted")).toContainText("Line amount: SGD 116");
  // A general review entry prioritizes unresolved work; evidence links to a
  // specific clean supplier retain the buyer's explicit selection.
  await page.goto("/comparisons/demo-studio/review");
  await expect(page.getByLabel("Reviewing", { exact: true })).toHaveValue("meridian");
  await page.goto("/comparisons/demo-studio/review?q=northstar");
  await expect(page.getByLabel("Reviewing", { exact: true })).toHaveValue("northstar");
  const workflow = page.getByRole("navigation", { name: "Comparison workflow" });
  const reviewStep = workflow.getByRole("link", { name: /Extraction review/ });
  await expect(reviewStep.locator(".step-number")).toHaveText("02");
  await expect(reviewStep.locator(".step-count")).toHaveText("2 issues");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await workflow.getByRole("link", { name: "Comparison", exact: true }).click();
  const activeStep = workflow.locator('[aria-current="step"]');
  await expect(activeStep).toHaveText("04Comparison");
  await expect.poll(() => activeStep.evaluate(element => {
    const item = element.getBoundingClientRect(), strip = element.parentElement!.getBoundingClientRect();
    return item.left >= strip.left - 1 && item.right <= strip.right + 1;
  })).toBe(true);
  await expect(page.locator(".matrix-scroll-hint")).toBeVisible();
  await expect(page.locator(".demo-note")).toContainText("saved sample extractions");
  await expect(page.locator(".comparison-alert")).toContainText("A quoted amount does not reconcile");
  await expect(page.locator(".comparison-alert").getByRole("link", { name: "Review issues" })).toBeVisible();
  const firstPrice = await page.locator(".matrix-price").first().boundingBox();
  expect(firstPrice!.y + firstPrice!.height).toBeLessThan(844);
  // Resizing the overflowing strip reveals its active link without moving the
  // document; scrollIntoView would pull this scrolled page back to the tabs.
  await page.evaluate(() => { window.scrollTo({ top: 150, behavior: "instant" }); document.querySelector(".step-nav")!.scrollTo({ left: 0, behavior: "instant" }); });
  await page.setViewportSize({ width: 389, height: 844 });
  await expect.poll(() => activeStep.evaluate(element => {
    const item = element.getBoundingClientRect(), strip = element.parentElement!.getBoundingClientRect();
    return item.left >= strip.left - 1 && item.right <= strip.right + 1;
  })).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(150);
  const dimensions = await page.locator(".matrix-scroll").evaluate(element => ({ inner: element.scrollWidth, outer: element.clientWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.inner).toBeGreaterThan(dimensions.outer);
  expect(dimensions.page).toBe(dimensions.viewport);
  await page.evaluate(() => localStorage.setItem("fieldops-demo-v1", "[]"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "From quotations to a decision", exact: true })).toBeVisible();
  await expect(page.locator(".welcome-start-steps > li")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Your next decision starts here", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-storage-note")).toContainText("private quotations cannot be uploaded here");
});
