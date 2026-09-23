import { z } from "zod";
import { ProcessingError } from "../processing/errors";
import { billingBasis } from "../domain/billing";
import type { FieldValue, SourceSpan } from "../domain/types";
import { sectionFieldKeys, type ExtractedChunk } from "./schema";
import { commonInstruction, expandFocusedExtraction, focusedExtractionInstruction, focusedExtractionWireSchema, focusedItemWireSchema, type FocusedDescriptor, type FocusedKind } from "./focused-transport";

const addedKeys = ["packageSize", "packageUnit", "minimumOrder", "orderIncrement", "billingBasis", "duration", "scope", "leadTime", "taxRate"] as const;

const billingPhrases: Record<string, RegExp> = {
  hourly: /\b(?:per hour|hourly)\b/i, daily: /\b(?:per day|daily)\b/i,
  monthly: /\b(?:per month|monthly)\b/i, yearly: /\b(?:per year|yearly|annual|annually)\b/i,
  weekly: /\b(?:per week|weekly)\b/i, quarterly: /\b(?:per quarter|quarterly)\b/i,
  fixed_project: /\b(?:fixed fee|fixed project|lump sum|one time)\b/i,
  per_word: /\bper word\b/i, per_unit: /\bper unit\b/i, recurring: /\brecurring\b/i,
};
const normalizedBillingText = (text: string) => text.toLowerCase().replace(/[_/-]+/g, " ").replace(/\s+/g, " ").trim();

/** Conservative phrase gate for comparable v2 assertions, not general entailment.
 * Preserve the assertion for review when only a unit, an adjective in a service
 * description, a conflicting family or uncertain wording supports it. */
export function focusedBillingRequiresReview(field: FieldValue, sources: Map<string, SourceSpan>): boolean {
  const claimed = field.state === "value" ? billingBasis(field.value) : null;
  if (!claimed) return false; // Missing/unsupported bases already have review and calculation guards.
  const raw = normalizedBillingText(field.raw ?? "");
  if (!raw) return true;
  const clauses = field.sourceIds.flatMap(id => (sources.get(id)?.text ?? "").split(/[;|\n]/)).map(normalizedBillingText).filter(clause => clause.includes(raw));
  let supported = false;
  for (const clause of clauses) {
    if (/\b(?:not|no|non|without|excluding|excluded|neither|never|or|either|versus|vs|instead|may|might)\b|n['’]t\b/.test(clause)) return true;
    const families = Object.entries(billingPhrases).filter(([, pattern]) => pattern.test(clause)).map(([key]) => key);
    const labeled = /^(?:billing(?: basis| method)?|pricing basis|charging basis)\s*[:=]\s*(.+?)\.?$/.exec(clause);
    const labeledBasis = labeled ? billingBasis(labeled[1]) : null;
    if (labeledBasis && !families.includes(labeledBasis)) families.push(labeledBasis);
    // A concrete recurrence period is more specific than "recurring" in the same phrase.
    const concrete = families.filter(family => family !== "recurring");
    const relevant = concrete.length ? concrete : families;
    if (relevant.length > 1 || (relevant.length === 1 && relevant[0] !== claimed)) return true;
    const explicit = /\b(?:per (?:hour|day|month|year|week|quarter|word|unit)|fixed fee|lump sum)\b/.test(clause);
    const role = /\b(?:hourly|daily|monthly|yearly|annual|annually|weekly|quarterly|recurring|fixed project|one time) (?:billing|rate|price|fee|charge)\b/.test(clause);
    if (relevant.length === 1 && relevant[0] === claimed && (explicit || role || labeledBasis === claimed)) supported = true;
  }
  return !supported;
}

/** Named core fields cannot repeat or disappear into an untyped optional list. */
function itemSchema(knownIds: string[]) {
  const previous = focusedItemWireSchema(knownIds), text = previous.shape.fields.element.omit({ key: true });
  const decimal = text.extend({ value: z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable() });
  return previous.omit({ fields: true }).extend({ packageSize: decimal, packageUnit: text, minimumOrder: decimal, orderIncrement: decimal,
    billingBasis: text, duration: text, scope: text, leadTime: text, taxRate: decimal }).strict();
}

export function focusedContractWireSchema(kind: FocusedKind, slotIds: string[], knownIds: string[]) {
  if (kind === "document") return focusedExtractionWireSchema(kind, slotIds, knownIds);
  const item = itemSchema(knownIds);
  return z.object({ items: z.object(Object.fromEntries(slotIds.map(id => [id, item]))).strict(),
    uncertainties: z.array(z.object({ message: z.string(), sourceIds: z.array(z.enum(knownIds)) }).strict()) }).strict();
}

export function focusedContractInstruction(kind: FocusedKind): string {
  if (kind === "document") return focusedExtractionInstruction(kind);
  return `${commonInstruction}\nExtract exactly the caller's items object slots. Each slot must contain these named evidence fields exactly once: ${sectionFieldKeys.item.join(",")}. Include every field even when absent; never emit a fields list. Also return kind,taxBasis,attributes,tiers,discounts. attributes,tiers,discounts and uncertainties are JSON arrays, [] when empty, never objects with an items property. Read identifiers for services as well as goods. Never borrow another slot's sources. Description or identifier must cite its own target records; context supplies literal currency/column/tax information only. Keep continuation scope, package contents, minimum orders and exclusions with their own item. packageSize,minimumOrder,orderIncrement and taxRate use canonical decimal strings like quantity and prices, without unit suffixes or ranges. Preserve the exact supplier wording in raw; do not extract a single number from an ambiguous range. Record billingBasis from the supplier's explicit hourly, fixed fee, per-unit or recurring billing wording, retaining its exact excerpt and source IDs. A unit or service-looking description alone does not establish a billing basis. Do not infer a missing basis, duration or scope; use not_stated or cited ambiguous as appropriate. Keep useful industry-specific facts in attributes. kind may be unknown and taxBasis not_stated. Tiers need explicit min/max/unitPrice/unit/basis/sourceIds, null max only for an explicit open end. discounts is an array of zero or one explicit kind/value/basis/alreadyIncluded/sourceIds rule; never invent missing commercial metadata.`;
}

/** Pure shape conversion only: no scalar normalization, missing-value synthesis or repair. */
export function expandFocusedContract(data: unknown, descriptor: FocusedDescriptor): ExtractedChunk {
  const checked = focusedContractWireSchema(descriptor.kind, descriptor.slots.map(slot => slot.id), [...descriptor.targetIds, ...descriptor.contextIds]).safeParse(data);
  if (!checked.success) throw new ProcessingError(checked.error.issues.some(issue => issue.path.includes("sourceIds") || issue.path.includes("itemSourceId")) ? "invalid_evidence" : "invalid_output", "The response did not match its typed focused extraction contract.");
  if (descriptor.kind === "document") return expandFocusedExtraction(checked.data, descriptor);
  const incoming = checked.data as { items: Record<string, z.infer<ReturnType<typeof itemSchema>>>; uncertainties: { message: string; sourceIds: string[] }[] };
  const items = Object.fromEntries(Object.entries(incoming.items).map(([id, candidate]) => {
    const { packageSize, packageUnit, minimumOrder, orderIncrement, billingBasis, duration, scope, leadTime, taxRate, ...core } = candidate;
    const added = { packageSize, packageUnit, minimumOrder, orderIncrement, billingBasis, duration, scope, leadTime, taxRate };
    return [id, { ...core, fields: addedKeys.map(key => ({ key, ...added[key] })) }];
  }));
  return expandFocusedExtraction({ items, uncertainties: incoming.uncertainties }, descriptor);
}
