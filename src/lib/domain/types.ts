/** Public domain contracts: keep monetary values as decimal strings. */
export type FieldState = "value" | "not_stated" | "not_applicable" | "ambiguous";
export type FieldOrigin = "supplier" | "calculated" | "user";
export interface FieldValue<T = string> {
  state: FieldState; value: T | null; raw: string | null; sourceIds: string[];
  origin: FieldOrigin; candidates?: T[]; calculation?: { formula: string; inputPaths: string[]; version: string };
}
export function field<T>(value: T, sourceIds: string[] = [], raw?: string): FieldValue<T> {
  return { state: "value", value, raw: raw ?? String(value), sourceIds, origin: "supplier" };
}
export function absent<T = string>(state: Exclude<FieldState, "value"> = "not_stated", raw: string | null = null): FieldValue<T> {
  return { state, value: null, raw, sourceIds: [], origin: "supplier" };
}
export function valueOf<T>(value: FieldValue<T>): T | null { return value.state === "value" ? value.value : null; }
export interface SourceSpan {
  id: string; documentId: string; kind: "pdf_text" | "ocr" | "sheet" | "text" | "page";
  text: string; page?: number; sheet?: string; cell?: string; mergedMaster?: string;
  start?: number; end?: number; box?: { x: number; y: number; width: number; height: number };
  pageWidth?: number; pageHeight?: number; rotation?: number; confidence?: number;
}
export interface Attribute { key: string; label: string; type: "text" | "decimal" | "date" | "boolean"; value: FieldValue<string>; unit?: string; }
export interface Supplier { name: FieldValue; contact: FieldValue; email: FieldValue; phone: FieldValue; address: FieldValue; }
export interface PriceTier { min: string; max: string | null; unitPrice: string; unit: string; basis: "all_units" | "graduated" | "ambiguous"; sourceIds: string[]; }
export interface Discount { kind: "percent" | "fixed"; value: string; basis: "unit" | "line" | "order" | "ambiguous"; alreadyIncluded: boolean; sourceIds: string[]; }
export interface QuoteItem {
  id: string; kind: "goods" | "service" | "mixed" | "unknown";
  description: FieldValue; identifier: FieldValue; quantity: FieldValue; unit: FieldValue;
  packageSize: FieldValue; packageUnit: FieldValue; minimumOrder: FieldValue; orderIncrement: FieldValue;
  unitPrice: FieldValue; lineAmount: FieldValue; currency: FieldValue;
  billingBasis: FieldValue; duration: FieldValue; scope: FieldValue;
  leadTime: FieldValue; taxRate: FieldValue; taxBasis: "inclusive" | "exclusive" | "not_stated";
  tiers: PriceTier[]; discount: Discount | null; attributes: Attribute[]; sourceIds: string[];
}
export interface Charge { id: string; label: string; kind: "shipping" | "tax" | "setup" | "recurring" | "other" | "discount"; amount: FieldValue; currency: FieldValue; appliesTo: "quotation" | "item" | "unknown"; itemId?: string; billingPeriod?: string; }
export interface CommercialTerms { validity: FieldValue; availability: FieldValue; leadTime: FieldValue; delivery: FieldValue; payment: FieldValue; warranty: FieldValue; exclusions: FieldValue; notes: FieldValue; }
export type IssueCode = "missing_field" | "ambiguous_value" | "amount_mismatch" | "total_mismatch" | "incomplete_extraction" | "unreadable" | "unsupported" | "formula_unavailable" | "conflicting_specification" | "unverified_evidence" | "scope_mismatch" | "duplicate" | "quota";
export interface ReviewIssue { id: string; code: IssueCode; severity: "error" | "warning" | "info"; message: string; documentId: string; itemId?: string; fieldPath?: string; sourceIds: string[]; resolved: boolean; resolution?: string; }
export interface CoverageUnit { id: string; label: string; status: "parsed" | "empty" | "failed" | "unsupported"; sourceCount: number; message?: string; }
export interface ParseManifest { parserVersion: string; units: CoverageUnit[]; complete: boolean; warnings: string[]; }
export type ProcessingMode = "parse_only" | "ai";
export type ProcessingStage = "queued" | "validating" | "parsing" | "extracting" | "reconciling" | "source_ready" | "ready" | "partial" | "failed" | "cancelled" | "waiting_quota";
export interface Quotation {
  id: string; documentId: string; filename: string; format: string; contentHash: string;
  status: ProcessingStage; supplier: Supplier; quotationNumber: FieldValue; date: FieldValue;
  revision: FieldValue; currency: FieldValue; locale: FieldValue; statedSubtotal: FieldValue; statedTotal: FieldValue;
  items: QuoteItem[]; charges: Charge[]; terms: CommercialTerms; attributes: Attribute[];
  sources: SourceSpan[]; issues: ReviewIssue[]; manifest: ParseManifest;
  extractionVersion: number; sourceUrl?: string; originalText?: string; isDemo: boolean;
  supersedesId?: string; extractedAt?: string; model?: string; usage?: {
    inputTokens: number; outputTokens: number; costUsd: string | null; elapsedMs: number;
    /** Known response metadata only: unavailable usage is excluded and accepted checkpoints may be reused. This is not fresh-run billing. */
    scope?: "accepted_and_rejected_response_metadata"; unavailableUsageResponses?: number;
    acceptedSections?: number; rejectedSections?: number; cachedRejectedResponses?: number;
  };
}
export interface Correction { id: string; quotationId: string; path: string; before: FieldValue; after: FieldValue; author: string; createdAt: string; reason: string; baseVersion: number; operation?: "add_item" | "edit"; }
export type MatchClassification = "equivalent" | "alternative" | "not_comparable";
export interface MatchMember { quotationId: string; itemId: string; }
export interface MatchGroup {
  id: string; label: string; members: MatchMember[]; classification: MatchClassification;
  status: "proposed" | "approved" | "rejected" | "stale"; explanation: string; sourceIds: string[];
  requiredQuantity: string; requiredUnit: string; acceptedOrderQuantities: Record<string, string>;
  billingPeriods: string | null; requirements: string; approvedRevision: number | null;
}
export interface ExchangeRate { id: string; from: string; to: string; rate: string; date: string; source: string; }
export interface Comparison {
  id: string; workspaceId: string; name: string; description: string; createdAt: string; updatedAt: string;
  revision: number; isDemo: boolean; quotations: Quotation[]; groups: MatchGroup[]; corrections: Correction[];
  exchangeRates: ExchangeRate[]; preferences: { priority: "cost" | "lead_time" | "requirements"; notes: string };
}
export interface ParsedDocument { documentId: string; filename: string; format: string; contentHash: string; sources: SourceSpan[]; manifest: ParseManifest; originalText?: string; }
export interface ProcessingRun { id: string; comparisonId: string; documentId: string; processingMode: ProcessingMode; stage: ProcessingStage; progress: number; attempt: number; fence: string; inputRevision: number; cancelRequested: boolean; errorCode?: string; message?: string; createdAt: string; updatedAt: string; }
export const LIMITS = { files: 5, fileBytes: 20 * 1024 * 1024, pdfPages: 10, worksheets: 5, populatedCells: 20000, items: 100, textChars: 100000, imagePixels: 20000000 } as const;
export function emptyItem(id: string): QuoteItem {
  return { id, kind: "unknown", description: absent(), identifier: absent(), quantity: absent(), unit: absent(), packageSize: absent(), packageUnit: absent(), minimumOrder: absent(), orderIncrement: absent(), unitPrice: absent(), lineAmount: absent(), currency: absent(), billingBasis: absent(), duration: absent(), scope: absent(), leadTime: absent(), taxRate: absent(), taxBasis: "not_stated", tiers: [], discount: null, attributes: [], sourceIds: [] };
}
export function emptyQuotation(documentId: string, filename: string): Quotation {
  return { id: documentId, documentId, filename, format: filename.split(".").pop() ?? "text", contentHash: "", status: "queued", supplier: { name: absent(), contact: absent(), email: absent(), phone: absent(), address: absent() }, quotationNumber: absent(), date: absent(), revision: absent(), currency: absent(), locale: absent(), statedSubtotal: absent(), statedTotal: absent(), items: [], charges: [], terms: { validity: absent(), availability: absent(), leadTime: absent(), delivery: absent(), payment: absent(), warranty: absent(), exclusions: absent(), notes: absent() }, attributes: [], sources: [], issues: [], manifest: { parserVersion: "1", units: [], complete: false, warnings: [] }, extractionVersion: 0, isDemo: false };
}
