import Decimal from "decimal.js";
import { Comparison, FieldValue, MatchGroup, QuoteItem, Quotation, valueOf } from "./types";
import { D, decimal, convertQuantity, money } from "./numeric";
import { itemCompatibility } from "./matching";
import { leadTimeDecision, requirementDecisions } from "./decisions";
import { billingBasis, recurringBilling } from "./billing";
export { decimal, convertQuantity, money } from "./numeric";
const number = (f: FieldValue): Decimal | null => decimal(valueOf(f));
const text = (f: FieldValue): string => valueOf(f)?.trim().toLowerCase() ?? "";
export interface ItemCalculationOptions { requiredQuantity?: string; requiredUnit?: string; acceptedOrderQuantity?: string; billingPeriods?: string | null; }
export interface ItemCalculation {
  status: "eligible" | "needs_review" | "not_comparable"; amount: string | null; netAmount: string | null; taxAmount: string | null;
  currency: string | null; taxBasis: QuoteItem["taxBasis"]; requiredQuantity: string; requiredUnit: string; orderQuantity: string | null;
  orderUnit: string; surplus: string | null; unitPrice: string | null; reasons: string[]; sourceIds: string[];
  discrepancy: { stated: string; calculated: string; difference: string } | null;
}
function priceAt(item: QuoteItem, quantity: Decimal): { price: Decimal | null; error?: string } {
  if (!item.tiers.length) return { price: number(item.unitPrice) };
  if (item.tiers.some(t => t.basis !== "all_units")) return { price: null, error: "Only explicit all-unit quantity tiers can be recalculated. Clarify graduated or ambiguous tiers." };
  const matches = item.tiers.filter(t => {
    if (t.unit.trim().toLowerCase() !== text(item.unit)) return false;
    const min = decimal(t.min), max = t.max === null ? null : decimal(t.max);
    return min && min.gte(0) && (t.max === null || max) && quantity.gte(min) && (!max || quantity.lte(max));
  });
  if (matches.length !== 1) return { price: null, error: "Quantity tiers have a gap, overlap, or incompatible pricing unit for this order quantity." };
  return { price: decimal(matches[0].unitPrice) };
}
function discounted(item: QuoteItem, quantity: Decimal, price: Decimal): Decimal | null {
  let amount = quantity.mul(price); const discount = item.discount;
  if (!discount || discount.alreadyIncluded) return amount;
  const d = decimal(discount.value);
  if (!d || d.lt(0) || !["unit", "line"].includes(discount.basis)) return null;
  if (discount.kind === "percent") { if (d.gt(100)) return null; amount = amount.mul(new D(1).minus(d.div(100))); }
  else amount = amount.minus(discount.basis === "unit" ? d.mul(quantity) : d);
  return amount.gte(0) ? amount : null;
}
/** Original quote arithmetic does not depend on a buyer scenario, acceptance, MOQ or recurring horizon. */
export function quotedLineDiscrepancy(item: QuoteItem): ItemCalculation["discrepancy"] {
  const quantity = number(item.quantity), stated = number(item.lineAmount), currency = valueOf(item.currency);
  if (!quantity || quantity.lt(0) || !stated || !currency) return null;
  const price = priceAt(item, quantity).price, expected = price && price.gte(0) ? discounted(item, quantity, price) : null;
  return expected && !new D(money(expected, currency)).eq(stated) ? { stated: stated.toFixed(), calculated: money(expected, currency), difference: money(stated.minus(expected), currency) } : null;
}
/** Reprices a single indivisible supplier line; acceptedOrderQuantity is in the supplier's pricing unit. */
export function calculateItem(item: QuoteItem, options: ItemCalculationOptions = {}): ItemCalculation {
  const requiredQuantity = options.requiredQuantity ?? valueOf(item.quantity) ?? "", requiredUnit = options.requiredUnit ?? valueOf(item.unit) ?? "";
  const currency = valueOf(item.currency), orderUnit = valueOf(item.unit) ?? "";
  const result: ItemCalculation = { status: "eligible", amount: null, netAmount: null, taxAmount: null, currency, taxBasis: item.taxBasis, requiredQuantity, requiredUnit, orderQuantity: null, orderUnit, surplus: null, unitPrice: null, reasons: [], sourceIds: [...item.sourceIds], discrepancy: quotedLineDiscrepancy(item) };
  const fail = (message: string, incompatible = false) => { result.reasons.push(message); result.status = incompatible ? "not_comparable" : "needs_review"; return result; };
  const required = decimal(requiredQuantity);
  if (!required || required.lte(0)) return fail("Enter a positive required quantity; missing quantity is not zero.");
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return fail("Review the original currency before calculating.");
  let converted = convertQuantity(requiredQuantity, requiredUnit, orderUnit), packageFactor: Decimal | null = null;
  if (converted === null) {
    const size = number(item.packageSize), packageUnit = valueOf(item.packageUnit);
    const contents = packageUnit ? convertQuantity(requiredQuantity, requiredUnit, packageUnit) : null;
    if (!size || size.lte(0) || contents === null) return fail("Units are not convertible from explicit dimensions or package contents.", true);
    converted = new D(contents).div(size).toFixed(); packageFactor = size;
  }
  let requestedOrder = new D(converted), order = requestedOrder;
  let periodMultiplier = new D(1);
  const billing = billingBasis(valueOf(item.billingBasis));
  if (item.kind !== "goods" && !billing) return fail("The service billing basis is missing or unsupported. Clarify an explicit hourly, daily, fixed-project, per-word, per-unit, or recurring basis.");
  if (recurringBilling(billing)) {
    const periods = decimal(options.billingPeriods);
    if (!periods || !periods.isInteger() || periods.lte(0)) return fail("Set a whole-number service billing horizon; recurring fees are not a one-time total.");
    if (["month", "year", "week", "quarter", "period"].includes(orderUnit.toLowerCase())) requestedOrder = order = periods;
    else periodMultiplier = periods;
  }
  const moq = number(item.minimumOrder), increment = number(item.orderIncrement);
  if (item.minimumOrder.state === "ambiguous" || item.orderIncrement.state === "ambiguous") return fail("Clarify the minimum order or order increment.");
  if ((moq && moq.lt(0)) || (increment && increment.lte(0))) return fail("The stated order constraint is invalid.");
  if (moq && order.lt(moq)) order = moq;
  const step = increment ?? (packageFactor || ["pack", "box", "case"].includes(orderUnit.toLowerCase()) ? new D(1) : null);
  if (step) order = order.div(step).ceil().mul(step);
  result.orderQuantity = order.toFixed();
  if (options.acceptedOrderQuantity !== undefined) {
    const accepted = decimal(options.acceptedOrderQuantity);
    if (!accepted || accepted.lt(order) || (step && !accepted.mod(step).isZero())) return fail("The accepted order does not meet demand, minimum order, or order increments.");
    order = accepted; result.orderQuantity = order.toFixed();
  } else if (!order.eq(requestedOrder)) return fail(`Accept ordering ${order.toFixed()} ${orderUnit} to meet package or minimum-order requirements.`);
  const surplusOrder = order.minus(requestedOrder);
  // Calculate delivered contents first; subtracting a recurring pack fraction before multiplying produces decimal residue.
  const deliveredContents = packageFactor ? convertQuantity(order.mul(packageFactor).toFixed(), valueOf(item.packageUnit)!, requiredUnit) : null;
  result.surplus = deliveredContents !== null ? new D(deliveredContents).minus(required).toFixed() : convertQuantity(surplusOrder.toFixed(), orderUnit, requiredUnit);
  const tier = priceAt(item, order);
  if (!tier.price || tier.price.lt(0)) return fail(tier.error ?? "A valid non-negative unit price is required.");
  result.unitPrice = tier.price.toFixed();
  const periodAmount = discounted(item, order, tier.price);
  if (!periodAmount) return fail("The discount base or discount amount needs review.");
  const amount = periodAmount.mul(periodMultiplier);
  result.amount = money(amount, currency);
  const taxRate = number(item.taxRate);
  if (taxRate && taxRate.lt(0)) return fail("The tax rate is invalid.");
  if (item.taxBasis === "inclusive" && taxRate) {
    const net = amount.div(new D(1).plus(taxRate.div(100)));
    result.netAmount = money(net, currency); result.taxAmount = money(amount.minus(net), currency);
  } else if (item.taxBasis === "exclusive") {
    result.netAmount = result.amount;
    result.taxAmount = taxRate ? money(amount.mul(taxRate).div(100), currency) : null;
  }
  if (result.discrepancy) { result.reasons.push("Supplier line amount differs from independently calculated quantity × price after explicit discounts."); result.status = "needs_review"; }
  return result;
}

export interface CalculatedGroup { groupId: string; label: string; values: (ItemCalculation & { quotationId: string; itemId: string })[]; lowestQuotationIds: string[]; explanation: string; }
export interface SupplierTotal { quotationId: string; supplierName: string; currency: string | null; subtotal: string | null; knownCharges: string | null; total: string | null; coverage: number; requiredGroups: number; eligible: boolean; label: string; reasons: string[]; }
export interface Recommendation { kind: "cost" | "lead_time" | "requirements" | "clarification"; message: string; quotationIds: string[]; sourceIds: string[]; }
export interface ComparisonCalculation { groups: CalculatedGroup[]; suppliers: SupplierTotal[]; recommendations: Recommendation[]; calculatedAt: string; }
/** Currency lanes remain separate. Values from unapproved/alternative groups are previews and never recommendations. */
export function calculateComparison(comparison: Comparison): ComparisonCalculation {
  const used = new Set<string>();
  const groups = comparison.groups.filter(g => g.status !== "rejected").map(group => {
    const groupItems = group.members.flatMap(member => { const item = comparison.quotations.find(q => q.id === member.quotationId)?.items.find(i => i.id === member.itemId); return item ? [item] : []; });
    const blockingReasons = new Set<string>();
    for (let a = 0; a < groupItems.length; a++) for (let b = a + 1; b < groupItems.length; b++) for (const reason of itemCompatibility(groupItems[a], groupItems[b]).blockingReasons) blockingReasons.add(reason);
    if (["box", "pack", "case", "carton"].includes(group.requiredUnit.trim().toLowerCase())) {
      const anchor = groupItems[0], anchorUnit = anchor && valueOf(anchor.packageUnit);
      const contents = groupItems.map(item => anchorUnit && valueOf(item.packageSize) && valueOf(item.packageUnit) ? convertQuantity(valueOf(item.packageSize)!, valueOf(item.packageUnit)!, anchorUnit) : null);
      if (contents.some(value => value === null) || new Set(contents).size !== 1) blockingReasons.add("Required package quantities contain different or unknown amounts; enter demand in the explicit contents unit before comparing.");
    }
    const values = group.members.flatMap(member => {
      const quote = comparison.quotations.find(q => q.id === member.quotationId), item = quote?.items.find(i => i.id === member.itemId);
      if (!quote || !item) return [];
      const result = calculateItem(item, { requiredQuantity: group.requiredQuantity, requiredUnit: group.requiredUnit, acceptedOrderQuantity: group.acceptedOrderQuantities[quote.id], billingPeriods: group.billingPeriods });
      const key = `${quote.id}:${item.id}`;
      if (used.has(key)) { result.status = "not_comparable"; result.reasons.push("This source line is already used in another group; bundle prices cannot be counted twice."); }
      used.add(key);
      if (group.status !== "approved" || group.classification !== "equivalent") { result.status = "needs_review"; result.reasons.push("Approve equivalence before this value can support a recommendation."); }
      if (group.members.filter(m => m.quotationId === quote.id).length > 1) { result.status = "not_comparable"; result.reasons.push("Multiple source lines from one supplier need separate requirement groups; bundle allocation is not supported."); }
      if (!quote.manifest.complete || !["ready", "partial"].includes(quote.status)) { result.status = "needs_review"; result.reasons.push("Document extraction is incomplete or still processing."); }
      if (quote.issues.some(issue => !issue.resolved && (issue.code === "incomplete_extraction" || issue.code === "unverified_evidence"))) { result.status = "needs_review"; result.reasons.push("Resolve the quotation's outstanding coverage or evidence review before using its prices for a recommendation."); }
      if (!item.sourceIds.length || item.sourceIds.some(id => !quote.sources.some(source => source.id === id))) { result.status = "needs_review"; result.reasons.push("Associate this line with the quotation's preserved source before using its price for a recommendation."); }
      if (blockingReasons.size) { result.status = "not_comparable"; result.reasons.push(...blockingReasons); }
      return [{ ...result, quotationId: quote.id, itemId: item.id }];
    });
    const eligible = values.filter(v => v.status === "eligible" && v.amount !== null);
    const lanes = new Set(eligible.map(v => `${v.currency}:${v.taxBasis}`));
    const canRank = new Set(eligible.map(v => v.quotationId)).size >= 2 && lanes.size === 1 && eligible.every(v => v.taxBasis !== "not_stated");
    const minimum = canRank ? Decimal.min(...eligible.map(v => v.amount!)) : null;
    return { groupId: group.id, label: group.label, values, lowestQuotationIds: minimum ? eligible.filter(v => new D(v.amount!).eq(minimum)).map(v => v.quotationId) : [], explanation: canRank ? "Lowest comparable line amount at accepted quantities; excludes order-level charges." : "Insufficient approved, compatible values for a price recommendation." };
  });
  const suppliers = comparison.quotations.map(quote => supplierTotal(quote, groups, comparison.groups));
  const recommendations: Recommendation[] = groups.filter(g => g.lowestQuotationIds.length).map(g => ({ kind: "cost", message: `${g.label}: lowest comparable quoted line cost. ${g.explanation}`, quotationIds: g.lowestQuotationIds, sourceIds: g.values.filter(v => g.lowestQuotationIds.includes(v.quotationId)).flatMap(v => v.sourceIds) }));
  const unresolved = comparison.quotations.flatMap(q => q.issues.filter(i => !i.resolved));
  if (unresolved.length) recommendations.push({ kind: "clarification", message: `${unresolved.length} source issues remain unresolved. Clarify these before making a final purchasing decision.`, quotationIds: [...new Set(unresolved.map(i => comparison.quotations.find(q => q.documentId === i.documentId)?.id).filter((id): id is string => Boolean(id)))], sourceIds: unresolved.flatMap(i => i.sourceIds) });
  recommendations.push(leadTimeDecision(comparison), ...requirementDecisions(comparison, groups));
  recommendations.sort((a, b) => Number(b.kind === comparison.preferences.priority) - Number(a.kind === comparison.preferences.priority));
  return { groups, suppliers, recommendations, calculatedAt: new Date().toISOString() };
}
function supplierTotal(quote: Quotation, groups: CalculatedGroup[], rawGroups: MatchGroup[]): SupplierTotal {
  const currency = valueOf(quote.currency), reasons: string[] = [];
  const values = groups.flatMap(g => g.values.filter(v => v.quotationId === quote.id));
  const eligibleValues = values.filter(v => v.status === "eligible" && v.currency === currency && v.amount !== null);
  const requiredGroups = rawGroups.filter(g => g.status !== "rejected").length;
  const coverage = groups.filter(g => g.values.some(v => v.quotationId === quote.id && v.status === "eligible")).length;
  const basis = new Set(eligibleValues.map(v => v.taxBasis));
  if (basis.size > 1) reasons.push("Tax-inclusive and tax-exclusive line amounts cannot be added as a common cost basis.");
  if (coverage !== requiredGroups) reasons.push(`Only ${coverage} of ${requiredGroups} requirement groups have eligible prices.`);
  if (values.some(v => v.currency !== currency)) reasons.push("Different original currencies remain separate.");
  const shipping = quote.charges.find(c => c.kind === "shipping");
  if (!shipping || shipping.amount.state === "not_stated" || shipping.amount.state === "ambiguous") reasons.push("Delivery cost is not established; this is not a landed cost.");
  const hasRecurringScenario = rawGroups.some(group => group.status !== "rejected" && group.billingPeriods !== null && group.members.some(member => member.quotationId === quote.id));
  const unchanged = !hasRecurringScenario && values.every(v => number(quote.items.find(i => i.id === v.itemId)!.quantity)?.eq(v.orderQuantity ?? "NaN")) && values.length === quote.items.length;
  let chargeAmount = new D(0);
  for (const charge of quote.charges) {
    if (charge.amount.state === "not_applicable") continue;
    const amount = number(charge.amount);
    if (!amount || valueOf(charge.currency) !== currency || charge.appliesTo === "unknown") { reasons.push(`${charge.label}: amount, currency, or applicability needs clarification.`); continue; }
    if (!unchanged || charge.kind === "recurring" || charge.kind === "tax" || charge.kind === "discount") { reasons.push(`${charge.label}: confirm applicability or base before including it in this scenario.`); continue; }
    chargeAmount = chargeAmount.plus(amount);
  }
  const subtotalValue = basis.size <= 1 && eligibleValues.length ? eligibleValues.reduce((sum, v) => sum.plus(v.amount!), new D(0)) : null;
  const subtotal = subtotalValue && currency ? money(subtotalValue, currency) : null;
  if (basis.has("not_stated")) reasons.push("Tax inclusion is not stated.");
  const eligible = requiredGroups > 0 && coverage === requiredGroups && reasons.length === 0;
  return { quotationId: quote.id, supplierName: valueOf(quote.supplier.name) ?? "Unknown supplier", currency, subtotal, knownCharges: currency ? money(chargeAmount, currency) : null, total: subtotalValue && currency ? money(subtotalValue.plus(chargeAmount), currency) : null, coverage, requiredGroups, eligible, label: eligible ? "Comparable quoted subtotal + established charges" : "Known comparable amounts · incomplete cost", reasons };
}
