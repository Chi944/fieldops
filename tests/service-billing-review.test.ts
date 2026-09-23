import { describe, expect, it } from "vitest";
import { calculateComparison, calculateItem } from "../src/lib/domain/calculate";
import { applyCorrection } from "../src/lib/domain/corrections";
import { itemCompatibility } from "../src/lib/domain/matching";
import { reconcileQuotation, validateQuotation } from "../src/lib/domain/validation";
import { absent, emptyItem, emptyQuotation, field, type Comparison, type FieldValue, type QuoteItem, type Quotation } from "../src/lib/domain/types";

function quotation(id = "quote", kind: QuoteItem["kind"] = "service", basis: FieldValue = absent()): Quotation {
  const sourceId = `${id}:line`;
  const item: QuoteItem = {
    ...emptyItem(`${id}:item`), kind, sourceIds: [sourceId],
    description: field("Hourly installation service", [sourceId]), identifier: field("INSTALL", [sourceId]),
    quantity: field("2", [sourceId]), unit: field("hour", [sourceId]), unitPrice: field("10", [sourceId]),
    lineAmount: field("20", [sourceId]), currency: field("USD", [sourceId]),
    scope: field("Install the supplied equipment", [sourceId]), billingBasis: basis, taxBasis: "exclusive",
  };
  const result = emptyQuotation(id, `${id}.txt`);
  const sourceText = "Hourly installation service; quantity 2 hour; unit price USD 10; line amount USD 20; install the supplied equipment.";
  return { ...result, status: "ready", supplier: { ...result.supplier, name: field(id, [sourceId]) }, currency: field("USD", [sourceId]), items: [item],
    sources: [{ id: sourceId, documentId: id, kind: "text", text: sourceText, start: 0, end: sourceText.length }],
    manifest: { parserVersion: "test", complete: true, units: [], warnings: [] } };
}
function billingIssues(quote: Quotation) {
  return validateQuotation(quote).filter(issue => issue.fieldPath === `items.${quote.items[0].id}.billingBasis`);
}
function comparison(quotes: Quotation[]): Comparison {
  return { id: "comparison", workspaceId: "test", name: "Billing review", description: "", createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z", revision: 1, isDemo: false,
    quotations: quotes, corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" },
    groups: [{ id: "service-group", label: "Installation", members: quotes.map(quote => ({ quotationId: quote.id, itemId: quote.items[0].id })), classification: "equivalent", status: "approved", explanation: "Buyer approved", sourceIds: quotes.flatMap(quote => quote.items[0].sourceIds), requiredQuantity: "2", requiredUnit: "hour", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: 1 }] };
}

describe("service billing review", () => {
  it("surfaces a source-linked field issue without inferring hourly billing from the unit or description", () => {
    const quote = quotation(), original = structuredClone(quote);
    expect(billingIssues(quote)).toEqual([expect.objectContaining({ code: "missing_field", severity: "warning", itemId: "quote:item", fieldPath: "items.quote:item.billingBasis", sourceIds: ["quote:line"], resolved: false })]);
    expect(quote).toEqual(original);
    expect(calculateItem(quote.items[0])).toMatchObject({ status: "needs_review", amount: null });
  });

  it.each(["service", "mixed", "unknown"] as const)("requires review for unsupported or non-value billing on %s items", kind => {
    for (const basis of [absent(), absent("not_applicable"), field("best effort", ["quote:line"]), { ...absent("ambiguous", "hourly or fixed"), sourceIds: ["quote:line"] }]) {
      const quote = quotation("quote", kind, basis), issues = billingIssues(quote);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe(basis.state === "ambiguous" ? "ambiguous_value" : "missing_field");
      expect(issues[0].sourceIds).toEqual(["quote:line"]);
      expect(calculateItem(quote.items[0]).amount).toBeNull();
    }
  });

  it("checks supplier billing evidence without inventing references or rejecting a recorded user correction", () => {
    const quote = quotation("quote", "service", field("hourly", ["another-document:line"]));
    expect(billingIssues(quote)).toEqual([expect.objectContaining({ code: "unverified_evidence", severity: "error", sourceIds: [] })]);
    quote.items[0].billingBasis = { ...field("hourly"), origin: "user" };
    expect(billingIssues(quote)).toEqual([]);
  });

  it("keeps prices and equivalence blocked even when missing-billing warnings are acknowledged", () => {
    const first = reconcileQuotation(quotation("first")), second = reconcileQuotation(quotation("second"));
    for (const quote of [first, second]) for (const issue of quote.issues) { issue.resolved = true; issue.resolution = "Reviewed without a confirmed billing basis"; }
    const result = calculateComparison(comparison([first, second]));
    expect(result.groups[0].values.every(value => value.status !== "eligible" && value.amount === null)).toBe(true);
    expect(result.recommendations.filter(recommendation => recommendation.kind === "cost")).toEqual([]);
    second.items[0].billingBasis = field("hourly", ["second:line"]);
    expect(itemCompatibility(first.items[0], second.items[0]).compatible).toBe(false);
  });

  it("resolves the missing-field warning through an audited correction and still requires match reapproval", () => {
    const quote = reconcileQuotation(quotation()), before = structuredClone(quote.items[0].billingBasis), state = comparison([quote]);
    const corrected = applyCorrection(state, { quotationId: quote.id, path: `items.${quote.items[0].id}.billingBasis`, value: "hourly", reason: "Confirmed billing basis with the original quotation", author: "buyer", baseVersion: 1 });
    expect(corrected.corrections[0].before).toEqual(before);
    expect(corrected.quotations[0].items[0].billingBasis).toMatchObject({ value: "hourly", origin: "user", sourceIds: [] });
    expect(corrected.quotations[0].issues.find(issue => issue.fieldPath?.endsWith(".billingBasis"))).toMatchObject({ resolved: true });
    expect(corrected.groups[0].status).toBe("stale");
    expect(calculateItem(corrected.quotations[0].items[0])).toMatchObject({ status: "eligible", amount: "20.00" });
  });

  it("preserves supported billing vocabulary, goods behavior, and the existing recurring horizon requirement", () => {
    for (const value of ["hourly", "per_hour", "daily", "fixed_project", "per_word", "per_unit", "monthly"]) {
      expect(billingIssues(quotation("quote", "service", field(value, ["quote:line"])))).toEqual([]);
    }
    expect(billingIssues(quotation("quote", "goods"))).toEqual([]);
    expect(calculateItem(quotation("quote", "service", field("monthly", ["quote:line"])).items[0]).amount).toBeNull();
  });
});
