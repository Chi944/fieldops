import { describe, expect, it } from "vitest";
import { calculateComparison, calculateItem, convertQuantity } from "../src/lib/domain/calculate";
import { applyCorrection, StaleRevisionError } from "../src/lib/domain/corrections";
import { itemCompatibility, proposeMatches } from "../src/lib/domain/matching";
import { validateQuotation } from "../src/lib/domain/validation";
import { absent, emptyItem, field, QuoteItem } from "../src/lib/domain/types";
import { demoComparisons } from "../src/lib/demo";

function item(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return { ...emptyItem("test-item"), kind: "goods", description: field("Cable"), identifier: field("C-10"), quantity: field("3"), unit: field("each"), unitPrice: field("0.10"), lineAmount: field("0.30"), currency: field("SGD"), taxBasis: "exclusive", taxRate: field("9"), ...overrides };
}
describe("exact quantity and monetary calculations", () => {
  it("keeps decimal arithmetic exact and numeric zero distinct from missing", () => {
    expect(calculateItem(item()).amount).toBe("0.30");
    expect(calculateItem(item({ unitPrice: field("0"), lineAmount: field("0") })).amount).toBe("0.00");
    expect(calculateItem(item({ unitPrice: absent() })).amount).toBeNull();
    expect(calculateItem(item(), { requiredQuantity: "0" }).status).toBe("needs_review");
  });
  it("converts only known dimensions and never guesses billing periods", () => {
    expect(convertQuantity("1.5", "kg", "g")).toBe("1500");
    expect(convertQuantity("60", "minute", "hour")).toBe("1");
    expect(convertQuantity("1", "kg", "l")).toBeNull();
    expect(convertQuantity("1", "month", "hour")).toBeNull();
    expect(convertQuantity("1", "box", "each")).toBeNull();
  });
  it("requires acceptance for whole packs and reports the surplus", () => {
    const pack = item({ quantity: field("2"), unit: field("box"), packageSize: field("12"), packageUnit: field("each"), unitPrice: field("24"), lineAmount: field("48") });
    const pending = calculateItem(pack, { requiredQuantity: "20", requiredUnit: "each" });
    expect(pending.status).toBe("needs_review"); expect(pending.orderQuantity).toBe("2"); expect(pending.amount).toBeNull();
    const accepted = calculateItem(pack, { requiredQuantity: "20", requiredUnit: "each", acceptedOrderQuantity: "2" });
    expect(accepted.amount).toBe("48.00"); expect(accepted.surplus).toBe("4");
    expect(calculateItem(pack, { requiredQuantity: "20", requiredUnit: "each", acceptedOrderQuantity: "1.9" }).amount).toBeNull();
  });
  it("does not use an unspecified package unit", () => {
    expect(calculateItem(item({ unit: field("box"), packageSize: field("12") }), { requiredQuantity: "20", requiredUnit: "each" }).status).toBe("not_comparable");
  });
  it("applies MOQ and order increments before selecting an all-unit tier", () => {
    const tiered = item({ quantity: field("12"), minimumOrder: field("10"), orderIncrement: field("6"), unitPrice: field("8"), lineAmount: field("96"), tiers: [{ min: "1", max: "9", unitPrice: "10", unit: "each", basis: "all_units", sourceIds: [] }, { min: "10", max: null, unitPrice: "8", unit: "each", basis: "all_units", sourceIds: [] }] });
    expect(calculateItem(tiered, { requiredQuantity: "8" }).orderQuantity).toBe("12");
    const accepted = calculateItem(tiered, { requiredQuantity: "8", acceptedOrderQuantity: "12" });
    expect(accepted.unitPrice).toBe("8"); expect(accepted.amount).toBe("96.00"); expect(accepted.surplus).toBe("4");
  });
  it("rejects ambiguous, graduated and overlapping tiers", () => {
    const tier = { min: "1", max: null, unitPrice: "1", unit: "each", basis: "all_units" as const, sourceIds: [] };
    expect(calculateItem(item({ tiers: [{ ...tier, basis: "graduated" }] })).amount).toBeNull();
    expect(calculateItem(item({ tiers: [tier, tier] })).amount).toBeNull();
  });
  it("applies a line discount once and respects already-net prices", () => {
    const discount = { kind: "percent" as const, value: "10", basis: "line" as const, alreadyIncluded: false, sourceIds: [] };
    expect(calculateItem(item({ quantity: field("2"), unitPrice: field("100"), lineAmount: field("180"), discount })).amount).toBe("180.00");
    expect(calculateItem(item({ quantity: field("2"), unitPrice: field("90"), lineAmount: field("180"), discount: { ...discount, alreadyIncluded: true } })).amount).toBe("180.00");
    expect(calculateItem(item({ discount: { ...discount, basis: "order" } })).amount).toBeNull();
  });
  it("keeps supplier discrepancies visible without replacing the quotation", () => {
    const quoted = item({ unitPrice: field("26"), quantity: field("4"), lineAmount: field("116") });
    const result = calculateItem(quoted);
    expect(result.discrepancy).toEqual({ stated: "116", calculated: "104.00", difference: "12.00" });
    expect(result.status).toBe("needs_review"); expect(quoted.lineAmount.value).toBe("116");
  });
  it("derives inclusive tax only from an explicit rate", () => {
    const inclusive = item({ quantity: field("1"), unitPrice: field("109"), lineAmount: field("109"), taxBasis: "inclusive" });
    expect(calculateItem(inclusive).netAmount).toBe("100.00"); expect(calculateItem(inclusive).taxAmount).toBe("9.00");
    expect(calculateItem({ ...inclusive, taxRate: absent() }).netAmount).toBeNull();
  });
  it("requires whole billing periods and includes recurring cost over the horizon", () => {
    const service = item({ kind: "service", quantity: field("1"), unit: field("site"), unitPrice: field("720"), lineAmount: field("720"), billingBasis: field("monthly") });
    expect(calculateItem(service).amount).toBeNull();
    expect(calculateItem(service, { billingPeriods: "12" }).amount).toBe("8640.00");
    expect(calculateItem(service, { billingPeriods: "1.5" }).amount).toBeNull();
  });
});
describe("matching and decision safeguards", () => {
  it("identical identifiers do not override conflicting specifications", () => {
    const a = item({ attributes: [{ key: "grade", label: "Grade", type: "text", value: field("MERV 13") }] });
    const b = item({ attributes: [{ key: "grade", label: "Grade", type: "text", value: field("MERV 8") }] });
    expect(itemCompatibility(a, b).classification).toBe("alternative");
  });
  it("does not assume equally named boxes contain equal quantities", () => {
    const first = item({ unit: field("box"), packageSize: absent(), packageUnit: absent() });
    const second = item({ unit: field("box"), packageSize: absent(), packageUnit: absent() });
    expect(itemCompatibility(first, second).compatible).toBe(false);
  });
  it("does not mark hourly and fixed-scope services equivalent", () => {
    const a = item({ kind: "service", unit: field("hour"), billingBasis: field("hourly"), scope: field("Install") });
    const b = item({ kind: "service", unit: field("project"), billingBasis: field("fixed_project"), scope: field("Install") });
    expect(itemCompatibility(a, b).compatible).toBe(false);
  });
  it("creates five flagship groups without duplicate source-line membership", () => {
    const comparison = demoComparisons()[0], groups = proposeMatches(comparison.quotations);
    expect(groups).toHaveLength(5);
    const ids = groups.flatMap(g => g.members.map(m => `${m.quotationId}:${m.itemId}`));
    expect(new Set(ids).size).toBe(15);
    expect(groups.find(g => g.label === "Studio installation")?.classification).toBe("alternative");
  });
  it("excludes unreviewed, discrepant and mixed-currency values from recommendations", () => {
    const [studio, , event] = demoComparisons(), result = calculateComparison(studio);
    const cable = result.groups.find(g => g.label === "Studio cable kit")!;
    expect(cable.lowestQuotationIds).not.toContain("meridian");
    expect(result.groups.find(g => g.label === "Studio installation")!.lowestQuotationIds).toEqual([]);
    expect(calculateComparison(event).groups.every(g => g.lowestQuotationIds.length === 0)).toBe(true);
    expect(result.suppliers.find(s => s.quotationId === "meridian")!.eligible).toBe(false);
  });
  it("does not rank unstated tax as favorable or sum mixed tax bases", () => {
    const comparison = demoComparisons()[0];
    comparison.groups = [comparison.groups[0]];
    comparison.quotations.forEach(q => { q.items[0].taxBasis = "not_stated"; });
    expect(calculateComparison(comparison).groups[0].lowestQuotationIds).toEqual([]);
  });
  it("prevents bundle allocations and duplicate counting", () => {
    const comparison = demoComparisons()[0], first = comparison.groups[0];
    first.members.push({ quotationId: "northstar", itemId: "northstar-light" });
    const result = calculateComparison(comparison);
    expect(result.groups[0].values.filter(v => v.quotationId === "northstar").every(v => v.status === "not_comparable")).toBe(true);
    expect(result.groups.flatMap(g => g.values).find(v => v.itemId === "northstar-light" && v.reasons.some(r => r.includes("already used")))).toBeDefined();
  });
});
describe("immutable review and provenance", () => {
  it("retains the exact previous interpretation and invalidates related approval", () => {
    const comparison = demoComparisons()[0], original = structuredClone(comparison);
    const changed = applyCorrection(comparison, { quotationId: "northstar", path: "items.northstar-chair.unitPrice", value: "180", reason: "Supplier confirmed amended price", author: "Buyer", baseVersion: 1 });
    expect(comparison).toEqual(original); expect(changed.revision).toBe(2);
    expect(changed.corrections[0].before.value).toBe("185"); expect(changed.corrections[0].after.origin).toBe("user");
    expect(changed.groups[0].status).toBe("stale"); expect(changed.quotations[0].extractionVersion).toBe(1);
  });
  it("rejects stale and unsafe edits while allowing unrelated contact corrections", () => {
    const comparison = demoComparisons()[0];
    const input = { quotationId: "northstar", path: "supplier.contact", value: "New contact", reason: "Confirmed", author: "Buyer", baseVersion: 1 };
    expect(() => applyCorrection(comparison, { ...input, baseVersion: 0 })).toThrow(StaleRevisionError);
    expect(() => applyCorrection(comparison, { ...input, path: "__proto__.name" })).toThrow();
    expect(applyCorrection(comparison, input).groups[0].status).toBe("approved");
  });
  it("every demo source span points to exactly the claimed original text", () => {
    for (const comparison of demoComparisons()) for (const quotation of comparison.quotations) {
      expect(quotation.isDemo).toBe(true); expect(quotation.originalText).toContain("fictional supplier");
      for (const source of quotation.sources) expect(quotation.originalText!.slice(source.start, source.end)).toBe(source.text);
      expect(validateQuotation(quotation).filter(i => i.code === "unverified_evidence")).toEqual([]);
    }
  });
  it("detects incomplete extraction and fabricated references", () => {
    const quotation = demoComparisons()[0].quotations[0];
    quotation.manifest.complete = false; quotation.items[0].unitPrice.sourceIds = ["invented-page"];
    expect(validateQuotation(quotation).map(i => i.code)).toContain("incomplete_extraction");
    expect(validateQuotation(quotation).map(i => i.code)).toContain("unverified_evidence");
  });
  it("detects a supplier total discrepancy using explicit original charges", () => {
    const quotation = demoComparisons()[0].quotations[0];
    quotation.statedTotal.value = "1";
    expect(validateQuotation(quotation).some(i => i.code === "total_mismatch" && i.fieldPath === "statedTotal")).toBe(true);
  });
});
