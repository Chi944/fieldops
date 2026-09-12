import Decimal from "decimal.js";
import { convertQuantity, decimal } from "./numeric";
import { MatchClassification, MatchGroup, QuoteItem, Quotation, valueOf } from "./types";
import { billingBasis } from "./billing";

export const normalize = (value: string): string => value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const tokens = (value: string) => new Set(normalize(value).split(" ").filter(v => v && !["the", "and", "of", "a", "with", "for"].includes(v)));
export function textSimilarity(a: string, b: string): number {
  const first = tokens(a), second = tokens(b), union = new Set([...first, ...second]);
  return union.size ? [...first].filter(t => second.has(t)).length / union.size : 0;
}
export interface Compatibility { classification: MatchClassification; compatible: boolean; reasons: string[]; blockingReasons: string[]; score: number; }
/** Shared deterministic vetoes for the baseline and AI proposals. Never establishes buyer approval. */
export function itemCompatibility(a: QuoteItem, b: QuoteItem): Compatibility {
  const reasons: string[] = [];
  const firstId = normalize(valueOf(a.identifier) ?? ""), secondId = normalize(valueOf(b.identifier) ?? "");
  const descriptionScore = textSimilarity(valueOf(a.description) ?? "", valueOf(b.description) ?? "");
  const sameId = Boolean(firstId && firstId === secondId), score = sameId ? 1 : descriptionScore;
  if (a.kind !== "unknown" && b.kind !== "unknown" && a.kind !== b.kind) reasons.push("Different goods/service classifications.");
  const firstUnit = valueOf(a.packageUnit) ?? valueOf(a.unit) ?? "", secondUnit = valueOf(b.packageUnit) ?? valueOf(b.unit) ?? "";
  if (convertQuantity("1", firstUnit, secondUnit) === null) reasons.push("Different or unknown unit dimensions/package contents.");
  for (const item of [a, b]) if (["box", "pack", "case", "carton"].includes(normalize(valueOf(item.unit) ?? "")) && (!decimal(valueOf(item.packageSize))?.gt(0) || item.packageUnit.state !== "value")) reasons.push("Package contents are not explicit; equally named boxes do not establish equal quantities.");
  const billingA = billingBasis(valueOf(a.billingBasis)), billingB = billingBasis(valueOf(b.billingBasis));
  if (a.kind !== "goods" || b.kind !== "goods") {
    if (!billingA || !billingB || billingA !== billingB) reasons.push("Billing bases are missing or different; hourly and fixed-project offers are not equivalent.");
    const scopeA = normalize(valueOf(a.scope) ?? ""), scopeB = normalize(valueOf(b.scope) ?? "");
    if (!scopeA || !scopeB || scopeA !== scopeB) reasons.push("Service scope needs explicit buyer review.");
    if (normalize(valueOf(a.duration) ?? "") !== normalize(valueOf(b.duration) ?? "")) reasons.push("Different service durations or included periods.");
  }
  if (firstId && secondId && firstId !== secondId) reasons.push("Supplier identifiers differ; verify product identity or alternatives.");
  for (const attribute of a.attributes) {
    const other = b.attributes.find(v => normalize(v.key) === normalize(attribute.key));
    if (other && attribute.value.state === "value" && other.value.state === "value" && normalize(String(attribute.value.value)) !== normalize(String(other.value.value))) reasons.push(`Conflicting ${attribute.label.toLowerCase()}: ${attribute.value.value} versus ${other.value.value}.`);
    if (attribute.value.state === "ambiguous" || other?.value.state === "ambiguous") reasons.push(`Ambiguous ${attribute.label.toLowerCase()}.`);
  }
  if (a.description.state !== "value" || b.description.state !== "value") reasons.push("An item description is missing or ambiguous.");
  const plausible = sameId || descriptionScore >= 0.5;
  const equivalent = plausible && score >= 0.75 && reasons.length === 0;
  const blockingReasons = reasons.filter(reason => !reason.startsWith("Supplier identifiers differ"));
  return { classification: equivalent ? "equivalent" : plausible ? "alternative" : "not_comparable", compatible: equivalent, reasons, blockingReasons, score };
}
export const compatibility = itemCompatibility;

/** Simple identifier/token baseline; deterministic grouping, one indivisible source line per supplier per group. */
export function proposeMatches(quotations: Quotation[]): MatchGroup[] {
  const groups: MatchGroup[] = [], lookup = new Map<string, QuoteItem>();
  for (const quotation of quotations) for (const item of quotation.items) lookup.set(`${quotation.id}:${item.id}`, item);
  for (const quotation of quotations) {
    for (const item of quotation.items) {
      let best: { group: MatchGroup; result: Compatibility } | null = null;
      for (const group of groups) {
        if (group.members.some(m => m.quotationId === quotation.id)) continue;
        const anchor = group.members[0], candidate = lookup.get(`${anchor.quotationId}:${anchor.itemId}`)!;
        const result = itemCompatibility(candidate, item);
        if (result.classification === "not_comparable" || (best && result.score <= best.result.score)) continue;
        best = { group, result };
      }
      if (best) {
        best.group.members.push({ quotationId: quotation.id, itemId: item.id });
        // Check every pair so a compatible anchor cannot hide conflicts between later members.
        const conflicts = best.group.members.slice(0, -1).flatMap(m => itemCompatibility(lookup.get(`${m.quotationId}:${m.itemId}`)!, item).reasons);
        if (best.result.classification !== "equivalent" || conflicts.length) best.group.classification = "alternative";
        best.group.explanation = best.group.classification === "equivalent" ? "Identifier or strong description match with compatible explicit units and specifications. Buyer approval is required." : [...new Set([...conflicts, ...best.result.reasons])].join(" ") || "Similar descriptions suggest a possible alternative; equivalence is unverified.";
        best.group.sourceIds.push(...item.sourceIds);
      } else {
        const pack = valueOf(item.packageSize), packageUnit = valueOf(item.packageUnit), quotedQuantity = valueOf(item.quantity) ?? "1";
        groups.push({ id: `group-${quotation.id}-${item.id}`, label: valueOf(item.description) ?? "Untitled item", members: [{ quotationId: quotation.id, itemId: item.id }], classification: "equivalent", status: "proposed", explanation: "Unmatched source item. Add another supplier or regroup an appropriate alternative.", sourceIds: [...item.sourceIds], requiredQuantity: pack && packageUnit ? new Decimal(quotedQuantity).mul(pack).toFixed() : quotedQuantity, requiredUnit: packageUnit ?? valueOf(item.unit) ?? "each", acceptedOrderQuantities: {}, billingPeriods: null, requirements: "", approvedRevision: null });
      }
    }
  }
  return groups;
}
