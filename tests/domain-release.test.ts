import { describe, expect, it } from "vitest";
import { demoComparisons } from "../src/lib/demo";
import { calculateComparison, calculateItem } from "../src/lib/domain/calculate";
import { validateQuotation } from "../src/lib/domain/validation";
import { applyCorrection, resolveCorrectableField, restoreCorrectionValue } from "../src/lib/domain/corrections";
import { emptyItem, field } from "../src/lib/domain/types";
import { itemCompatibility } from "../src/lib/domain/matching";

const monthly = () => ({ ...emptyItem("monthly-seat"), kind: "service" as const, description: field("Monthly support seat"), identifier: field("S-1"), quantity: field("1"), unit: field("seat"), unitPrice: field("50"), lineAmount: field("50"), currency: field("SGD"), billingBasis: field("monthly"), scope: field("One support seat per month"), taxBasis: "exclusive" as const, minimumOrder: field("2"), tiers: [{ min: "1", max: "9", unitPrice: "50", unit: "seat", basis: "all_units" as const, sourceIds: [] }, { min: "10", max: null, unitPrice: "40", unit: "seat", basis: "all_units" as const, sourceIds: [] }] });
describe("release trust-boundary regressions", () => {
  it("does not treat twelve months of one seat as twelve seats for MOQ or tier eligibility", () => {
    const pending = calculateItem(monthly(), { requiredQuantity: "1", requiredUnit: "seat", billingPeriods: "12" });
    expect(pending.status).toBe("needs_review"); expect(pending.orderQuantity).toBe("2"); expect(pending.amount).toBeNull();
    const accepted = calculateItem(monthly(), { requiredQuantity: "1", requiredUnit: "seat", billingPeriods: "12", acceptedOrderQuantity: "2" });
    expect(accepted.unitPrice).toBe("50"); expect(accepted.amount).toBe("1200.00"); expect(accepted.surplus).toBe("1");
  });
  it("checks original recurring line arithmetic before a scenario billing horizon is supplied", () => {
    const quote = demoComparisons()[0].quotations[0], item = monthly(); item.lineAmount = field("80"); quote.items = [item];
    expect(validateQuotation(quote).some(issue => issue.code === "amount_mismatch")).toBe(true);
    const calculation = calculateItem(item);
    expect(calculation.discrepancy?.calculated).toBe("50.00");
  });
  it("recognises explicit recurring aliases and withholds unfamiliar billing expressions", () => {
    const item = monthly(); item.billingBasis = field("per month");
    expect(calculateItem(item).amount).toBeNull();
    expect(calculateItem(item, { billingPeriods: "12", acceptedOrderQuantity: "2" }).amount).toBe("1200.00");
    expect(itemCompatibility(item, monthly()).compatible).toBe(true);
    item.billingBasis = field("retainer subject to usage adjustment");
    expect(calculateItem(item, { billingPeriods: "12", acceptedOrderQuantity: "2" }).status).toBe("needs_review");
    expect(itemCompatibility(item, item).compatible).toBe(false);
  });
  it("cannot compare a box of twelve with a box of twenty-four as equal required quantities", () => {
    const comparison = demoComparisons()[0], group = comparison.groups[0]; comparison.groups = [group];
    group.requiredQuantity = "1"; group.requiredUnit = "box";
    comparison.quotations.forEach((quote, index) => {
      const item = quote.items[0]; item.unit = field("box", item.sourceIds); item.packageSize = field(index === 0 ? "12" : "24", item.sourceIds); item.packageUnit = field("each", item.sourceIds); item.quantity = field("1", item.sourceIds); item.lineAmount = { ...item.unitPrice };
    });
    const result = calculateComparison(comparison).groups[0];
    expect(result.values.every(value => value.status === "not_comparable")).toBe(true);
    expect(result.lowestQuotationIds).toEqual([]);
  });
  it("retains unlinked user lines as review previews without evidence-free recommendations", () => {
    const comparison = demoComparisons()[0], quote = comparison.quotations[0]; quote.items[0].sourceIds = [];
    const result = calculateComparison(comparison).groups[0];
    expect(result.values.find(value => value.quotationId === quote.id)?.status).toBe("needs_review");
    expect(result.lowestQuotationIds).not.toContain(quote.id);
  });
  it("withholds partial-extraction prices until the unresolved coverage issue is reviewed", () => {
    const comparison = demoComparisons()[0], quote = comparison.quotations[0]; quote.status = "partial";
    quote.issues.push({ id: "omitted-row", code: "incomplete_extraction", severity: "error", message: "A priced source row was not interpreted", documentId: quote.documentId, sourceIds: [], resolved: false });
    const first = calculateComparison(comparison).groups[0];
    expect(first.values.find(v => v.quotationId === quote.id)?.status).toBe("needs_review");
    expect(first.lowestQuotationIds).not.toContain(quote.id);
    quote.issues.find(i => i.id === "omitted-row")!.resolved = true;
    expect(calculateComparison(comparison).groups[0].values.find(v => v.quotationId === quote.id)?.status).toBe("eligible");
  });
  it("acknowledging a missing delivery issue never supplies a zero delivery cost", () => {
    const comparison = demoComparisons()[0], quote = comparison.quotations.find(q => q.id === "meridian")!;
    quote.issues.forEach(issue => { issue.resolved = true; });
    const total = calculateComparison(comparison).suppliers.find(s => s.quotationId === quote.id)!;
    expect(total.eligible).toBe(false); expect(total.reasons.some(reason => reason.includes("Delivery cost is not established"))).toBe(true);
    const cable = calculateComparison(comparison).groups.find(g => g.label === "Studio cable kit")!.values.find(v => v.quotationId === quote.id)!;
    expect(cable.status).toBe("needs_review"); expect(cable.discrepancy?.difference).toBe("12.00");
  });
  it("audits typed tax/kind corrections, validates enums, and restores originals for exports", () => {
    const comparison = demoComparisons()[0], quotationId = comparison.quotations[0].id, path = "items.northstar-chair.taxBasis";
    const changed = applyCorrection(comparison, { quotationId, path, value: "inclusive", reason: "Buyer verified tax basis", author: "Buyer", baseVersion: 1 });
    expect(changed.quotations[0].items[0].taxBasis).toBe("inclusive"); expect(comparison.quotations[0].items[0].taxBasis).toBe("exclusive");
    expect(changed.corrections[0].before).toMatchObject({ value: "exclusive", raw: null });
    expect(changed.corrections[0].after.origin).toBe("user"); expect(changed.corrections[0].operation).toBe("edit"); expect(changed.groups[0].status).toBe("stale");
    expect(resolveCorrectableField(changed.quotations[0], "items.0.taxBasis").value).toBe("inclusive");
    restoreCorrectionValue(changed.quotations[0], path, changed.corrections[0].before);
    expect(changed.quotations[0].items[0].taxBasis).toBe("exclusive");
    expect(() => applyCorrection(comparison, { quotationId, path, value: "free", reason: "Invalid", author: "Buyer", baseVersion: 1 })).toThrow("supported taxBasis");
    expect(() => applyCorrection(comparison, { quotationId, path: "status", value: "ready", reason: "Invalid", author: "Buyer", baseVersion: 1 })).toThrow();
  });
  it("reconciles issue state after a correction in the shared helper used by demo and live views", () => {
    const comparison = demoComparisons()[0];
    const changed = applyCorrection(comparison, { quotationId: "meridian", path: "items.meridian-cable.lineAmount", value: "104", reason: "Demonstration correction after explicit confirmation", author: "Buyer", baseVersion: 1 });
    expect(comparison.quotations[1].issues.some(issue => issue.code === "amount_mismatch")).toBe(true);
    expect(changed.quotations[1].issues.some(issue => issue.code === "amount_mismatch")).toBe(false);
    expect(changed.corrections[0].before.value).toBe("116");
  });
});
