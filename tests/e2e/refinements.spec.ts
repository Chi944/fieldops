import { expect, test } from "@playwright/test";

test("review guidance connects workspace search, real issue evidence and unmatched offers", async ({ page }) => {
  // Only capability discovery is overridden. All samples, field/source selection,
  // filtering and matching changes exercise the application's actual demo path.
  await page.route("**/api/status", route => route.fulfill({ json: {
    mode: "demo", authenticated: false, canPersist: false, canUpload: false,
    canExtract: false, reasons: ["Public demonstration uses labelled sample data."],
  } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your quotation workspace", exact: true })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search comparisons", exact: true });
  await page.keyboard.press("/");
  await expect(search).not.toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();
  await search.fill("studio");
  await expect(page.locator(".comparison-list-row")).toHaveCount(1);
  await expect(page.locator(".comparison-list-row")).toContainText("Studio equipment & installation");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.locator(".comparison-list-row")).toHaveCount(3);

  const reviewFilter = page.locator(".list-controls").getByRole("button", { name: /^Needs review/ });
  await reviewFilter.click();
  await expect(reviewFilter).toHaveAttribute("aria-pressed", "true");
  await search.fill("no comparison with this name");
  await expect(page.getByRole("heading", { name: "No matching comparisons", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show all comparisons", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("button", { name: "All comparisons", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".comparison-list-row")).toHaveCount(3);
  await page.getByRole("link", { name: /2 open issues.*Next step for Studio equipment & installation/ }).click();
  await expect(page).toHaveURL(/\/comparisons\/demo-studio\/review\?q=meridian$/);

  await expect(page.getByLabel("Reviewing", { exact: true })).toHaveValue("meridian");
  const queue = page.getByRole("region", { name: "Quotation review progress", exact: true });
  await expect(queue).toContainText("2 issues need a decision");
  const nextIssue = queue.getByRole("button", { name: "Review next issue", exact: true });
  await nextIssue.click();
  const cableAmount = page.locator('[id="review-field-meridian-items.meridian-cable.lineAmount"]');
  await expect(cableAmount).toHaveClass(/selected/);
  await expect(cableAmount.getByRole("button", { name: "116", exact: true })).toBeFocused();
  const evidence = page.locator(".source-line.highlighted");
  await expect(evidence).toHaveCount(1);
  await expect(evidence).toHaveAttribute("id", "source-meridian-cable");
  await expect(evidence).toContainText("Quantity: 4 each");
  await expect(evidence).toContainText("Unit price: SGD 26 per each | Line amount: SGD 116");

  // The next issue uses an indexed charge path and has no supporting source ID.
  // It must open the actual charge field without inventing a shipping citation.
  await nextIssue.click();
  const shipping = page.locator('[id="review-field-meridian-charges.meridian-shipping.amount"]');
  await expect(shipping).toBeVisible();
  await expect(shipping).toHaveClass(/selected/);
  await expect(shipping.getByRole("button", { name: "Not stated", exact: true })).toBeFocused();
  await expect(page.locator(".source-line.highlighted")).toHaveCount(0);
  await expect(page.locator(".review-evidence-context")).toContainText("Delivery cost is not stated");
  await expect(page.locator(".review-evidence-context")).toContainText("No source reference is attached");
  await expect(queue).toContainText("2 issues need a decision");

  await nextIssue.click();
  await cableAmount.getByRole("button", { name: "Correct Line amount", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "Correct line amount", exact: true });
  await expect(correction.locator(".original-value")).toContainText("116");
  await correction.getByText("View supporting source", { exact: true }).click();
  await expect(correction.locator("blockquote")).toBeVisible();
  await expect(correction.locator("blockquote")).toContainText("Unit price: SGD 26 per each | Line amount: SGD 116");
  await expect(correction.locator(".correction-source-note")).toContainText("previous interpretation and your reason remain in correction history");
  await correction.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("navigation", { name: "Comparison workflow" }).getByRole("link", { name: /Item matching/ }).click();
  const chairs = page.locator(".match-group").filter({ has: page.getByRole("heading", { name: "Ergonomic studio chair", exact: true }) });
  await chairs.getByRole("button", { name: "Split Ergonomic studio chair from Northstar Studio Supply out of this group", exact: true }).click();
  const unmatchedFilter = page.getByRole("button", { name: /^Unmatched/ });
  await unmatchedFilter.click();
  await expect(unmatchedFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".match-group")).toHaveCount(1);
  await expect(page.locator(".match-group h3")).toContainText("Ergonomic studio chair — unmatched");
  await expect(page.locator(".match-group").getByRole("button", { name: "Approve equivalence", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Review source for Ergonomic studio chair from Northstar Studio Supply", exact: true })).toHaveAttribute("href", "/comparisons/demo-studio/review?q=northstar");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/comparisons/demo-studio/review?q=meridian");
  await page.getByRole("button", { name: "Review next issue", exact: true }).click();
  const focusedAmount = page.locator('[id="review-field-meridian-items.meridian-cable.lineAmount"]').getByRole("button", { name: "116", exact: true });
  await expect(focusedAmount).toBeFocused();
  await expect(focusedAmount).toBeInViewport({ ratio: 1 });
});
