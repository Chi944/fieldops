import Decimal from "decimal.js";
import { calculateItem, decimal, money } from "./calculate";
import { Quotation, ReviewIssue, valueOf } from "./types";

/** Deterministic verification returns issues; it never changes supplier-stated amounts. */
export function validateQuotation(quotation: Quotation): ReviewIssue[] {
  const issues: ReviewIssue[] = [], available = new Set(quotation.sources.map(s => s.id));
  const issue = (code: ReviewIssue["code"], message: string, sourceIds: string[] = [], itemId?: string, fieldPath?: string) => issues.push({ id: `${quotation.id}:${code}:${itemId ?? "quote"}:${issues.length}`, code, severity: ["incomplete_extraction", "unverified_evidence"].includes(code) ? "error" : "warning", message, documentId: quotation.documentId, itemId, fieldPath, sourceIds, resolved: false });
  if (!quotation.manifest.complete || quotation.manifest.units.some(u => ["failed", "unsupported"].includes(u.status))) issue("incomplete_extraction", "Some source content was not completely interpreted. Review the coverage report or provide a clearer document.");
  if (!quotation.items.length) issue("incomplete_extraction", "No line items were extracted. Supply clearer text or review the source manually.");
  if (quotation.supplier.name.state !== "value") issue("missing_field", "Supplier name needs review.", quotation.supplier.name.sourceIds, undefined, "supplier.name");
  for (const item of quotation.items) {
    for (const key of ["description", "quantity", "unit", "unitPrice", "currency"] as const) {
      const field = item[key];
      if (field.state === "not_stated" || field.state === "ambiguous") issue(field.state === "ambiguous" ? "ambiguous_value" : "missing_field", `${key} is ${field.state.replace("_", " ")}.`, field.sourceIds, item.id, `items.${item.id}.${key}`);
      if (field.state === "value" && field.origin === "supplier" && (!field.sourceIds.length || field.sourceIds.some(id => !available.has(id)))) issue("unverified_evidence", `${key} has no valid supporting source reference.`, field.sourceIds.filter(id => available.has(id)), item.id, `items.${item.id}.${key}`);
    }
    const calculation = calculateItem(item);
    if (calculation.discrepancy) issue("amount_mismatch", `Supplier line amount ${calculation.discrepancy.stated} differs from calculated ${calculation.discrepancy.calculated} by ${calculation.discrepancy.difference}.`, item.sourceIds, item.id, `items.${item.id}.lineAmount`);
  }
  const subtotal = decimal(valueOf(quotation.statedSubtotal)), amounts = quotation.items.map(i => decimal(valueOf(i.lineAmount))), currency = valueOf(quotation.currency);
  if (subtotal && currency && amounts.length && amounts.every((a): a is Decimal => a !== null) && quotation.items.every(i => valueOf(i.currency) === currency)) {
    const sum = amounts.reduce((a, b) => a.plus(b), new Decimal(0));
    if (!sum.eq(subtotal)) issue("total_mismatch", `Stated subtotal ${subtotal.toFixed()} differs from the sum of supplier-stated lines ${money(sum, currency)}.`, quotation.statedSubtotal.sourceIds, undefined, "statedSubtotal");
  }
  const total = decimal(valueOf(quotation.statedTotal));
  const activeCharges = quotation.charges.filter(c => c.amount.state !== "not_applicable");
  if (subtotal && total && currency && activeCharges.every(c => c.appliesTo === "quotation" && valueOf(c.currency) === currency && decimal(valueOf(c.amount)) !== null && c.kind !== "recurring") && quotation.items.every(i => i.taxBasis === "exclusive")) {
    // A missing tax component means the tax-inclusive total cannot be independently reconstructed.
    const hasTax = activeCharges.some(c => c.kind === "tax");
    const explicitZeroTax = quotation.items.length > 0 && quotation.items.every(i => decimal(valueOf(i.taxRate))?.isZero());
    if (hasTax || explicitZeroTax) {
      const expected = activeCharges.reduce((sum, c) => c.kind === "discount" ? sum.minus(valueOf(c.amount)!) : sum.plus(valueOf(c.amount)!), new Decimal(subtotal));
      if (!expected.eq(total)) issue("total_mismatch", `Stated total ${total.toFixed()} differs from stated subtotal plus explicit quotation charges ${money(expected, currency)}.`, quotation.statedTotal.sourceIds, undefined, "statedTotal");
    }
  }
  return issues;
}
export function reconcileQuotation(quotation: Quotation): Quotation {
  const old = quotation.issues.filter(i => !["amount_mismatch", "total_mismatch"].includes(i.code));
  const added = validateQuotation(quotation);
  const issues = [...old];
  for (const issue of added) if (!issues.some(i => i.code === issue.code && i.itemId === issue.itemId && i.fieldPath === issue.fieldPath)) issues.push(issue);
  return { ...quotation, issues };
}
