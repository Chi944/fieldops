import { Comparison, FieldState, FieldValue, QuoteItem, Quotation } from "./types";
import { decimal } from "./calculate";
import { reconcileQuotation } from "./validation";

export interface CorrectionInput { quotationId: string; path: string; value: string | null; state?: FieldState; reason: string; author: string; baseVersion: number; }
export class StaleRevisionError extends Error { constructor() { super("This comparison changed. Reload the latest version before saving your correction."); this.name = "StaleRevisionError"; } }
const isField = (value: unknown): value is FieldValue => Boolean(value && typeof value === "object" && "state" in value && "sourceIds" in value && "origin" in value);
/** Resolves only an existing FieldValue. Both items.<item-id>.<field> and items.<index>.<field> are supported. */
export function resolveField(root: unknown, path: string): FieldValue {
  const parts = path.split(".");
  if (!parts.length || parts.length > 8 || parts.some(p => ["__proto__", "constructor", "prototype"].includes(p))) throw new Error("Invalid correction path.");
  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current)) current = /^\d+$/.test(part) ? current[Number(part)] : current.find(v => v && typeof v === "object" && "id" in v && v.id === part);
    else if (current && typeof current === "object" && Object.hasOwn(current, part)) current = (current as Record<string, unknown>)[part];
    else throw new Error("The selected field no longer exists.");
  }
  if (!isField(current)) throw new Error("Corrections may change only source-linked field values.");
  return current;
}
const metadataValues = { kind: ["goods", "service", "mixed", "unknown"], taxBasis: ["inclusive", "exclusive", "not_stated"] } as const;
function metadata(root: unknown, path: string): { item: QuoteItem; key: keyof typeof metadataValues } | null {
  const matched = /^items\.([^.]+)\.(kind|taxBasis)$/.exec(path);
  if (!matched || !root || typeof root !== "object" || !("items" in root) || !Array.isArray(root.items)) return null;
  const items = root.items as QuoteItem[], item = /^\d+$/.test(matched[1]) ? items[Number(matched[1])] : items.find(item => item.id === matched[1]);
  if (!item) throw new Error("The selected item no longer exists.");
  return { item, key: matched[2] as keyof typeof metadataValues };
}
/** Only these two typed item properties join ordinary FieldValues as editable audited metadata. */
export function resolveCorrectableField(root: unknown, path: string): FieldValue {
  const target = metadata(root, path);
  if (!target) return resolveField(root, path);
  return { state: "value", value: target.item[target.key], raw: null, sourceIds: [...target.item.sourceIds], origin: "supplier" };
}
/** Restore an audited interpretation on a cloned quotation, including synthesized enum metadata. */
export function restoreCorrectionValue(quotation: Quotation, path: string, value: FieldValue): void {
  const target = metadata(quotation, path);
  if (target) {
    const restored = value.state === "value" ? value.value : target.key === "kind" ? "unknown" : "not_stated";
    if (restored === null || !(metadataValues[target.key] as readonly string[]).includes(restored)) throw new Error("Invalid typed quotation metadata.");
    if (target.key === "kind") target.item.kind = restored as QuoteItem["kind"];
    else target.item.taxBasis = restored as QuoteItem["taxBasis"];
    return;
  }
  const field = resolveField(quotation, path); Object.assign(field, structuredClone(value));
  if (!value.candidates) delete field.candidates;
  if (!value.calculation) delete field.calculation;
}
/** Immutable append-only correction audit. baseVersion is Comparison.revision, not extractionVersion. */
export function applyCorrection(comparison: Comparison, input: CorrectionInput): Comparison {
  if (comparison.revision !== input.baseVersion) throw new StaleRevisionError();
  if (!input.reason.trim() || !input.author.trim()) throw new Error("A correction requires an author and reason.");
  const copy = structuredClone(comparison), quotation = copy.quotations.find(q => q.id === input.quotationId);
  if (!quotation) throw new Error("Quotation not found.");
  const typed = metadata(quotation, input.path), target = resolveCorrectableField(quotation, input.path);
  let before = structuredClone(target);
  if (typed) {
    const previous = [...copy.corrections].reverse().find(correction => {
      if (correction.quotationId !== quotation.id) return false;
      const other = metadata(quotation, correction.path); return other?.item.id === typed.item.id && other.key === typed.key;
    });
    if (previous) before = structuredClone(previous.after);
  }
  const state = input.state ?? (input.value === null ? "not_stated" : "value");
  if (state === "value" && (input.value === null || input.value.trim() === "")) throw new Error("A stated value cannot be empty.");
  if (typed && (state !== "value" || input.value === null || !(metadataValues[typed.key] as readonly string[]).includes(input.value))) throw new Error(`Choose a supported ${typed.key}: ${metadataValues[typed.key].join(", ")}.`);
  const key = input.path.split(".").at(-1)!;
  if (state === "value" && ["quantity", "packageSize", "minimumOrder", "orderIncrement", "unitPrice", "lineAmount", "taxRate", "statedSubtotal", "statedTotal", "amount"].includes(key) && !decimal(input.value)) throw new Error("Enter an unformatted decimal value, for example 1234.50.");
  const after: FieldValue = { state, value: state === "value" ? input.value : null, raw: state === "value" ? input.value : null, sourceIds: [...before.sourceIds], origin: "user" };
  restoreCorrectionValue(quotation, input.path, after);
  const now = new Date().toISOString();
  copy.corrections.push({ id: crypto.randomUUID(), quotationId: quotation.id, path: input.path, before, after: structuredClone(after), author: input.author, createdAt: now, reason: input.reason.trim(), baseVersion: input.baseVersion, operation: "edit" });
  const itemSelector = input.path.startsWith("items.") ? input.path.split(".")[1] : null;
  const item = itemSelector ? quotation.items.find((i, index) => i.id === itemSelector || String(index) === itemSelector) : null;
  for (const issue of quotation.issues) {
    if ((issue.fieldPath === input.path || (item && issue.itemId === item.id && issue.fieldPath?.endsWith(`.${key}`))) && ["missing_field", "ambiguous_value"].includes(issue.code) && state === "value") { issue.resolved = true; issue.resolution = `User correction: ${input.reason.trim()}`; }
  }
  const identityOnly = input.path.startsWith("supplier.") || ["quotationNumber", "date", "revision"].includes(input.path);
  if (!identityOnly) for (const group of copy.groups) {
    if (group.members.some(m => m.quotationId === quotation.id && (!item || m.itemId === item.id))) {
      if (group.status === "approved") group.status = "stale";
      group.approvedRevision = null; delete group.acceptedOrderQuantities[quotation.id];
    }
  }
  copy.quotations = copy.quotations.map(q => q.id === quotation.id ? reconcileQuotation(q) : q);
  copy.revision++; copy.updatedAt = now;
  return copy;
}
