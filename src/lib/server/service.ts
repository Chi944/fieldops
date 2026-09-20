import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyQuotation, emptyItem, absent, LIMITS, type Comparison, type FieldValue, type MatchGroup, type ProcessingMode } from "@/lib/domain/types";
import { applyCorrection } from "@/lib/domain/corrections";
import { reconcileQuotation } from "@/lib/domain/validation";
import { authorize, type RequestContext } from "./context";
import { ApiError, json } from "./errors";
import { capabilities, checkRequestBoundary, configuration } from "./config";
import { dispatchRun, hydrateComparison, startLocalRunner, hasCompleteSourceCoverage } from "./jobs";
import { LocalRepository } from "./local-repository";
import { storageUploadIntent, storageFinalizeUpload, storageDiscardUpload, storageSourceUrl } from "./neon-storage";
import type { DocumentRecord, RunRecord } from "./contracts";

const id = z.string().uuid();
const text = z.string().max(10000);
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/).max(50);
const positive = decimal.refine((v) => Number(v) > 0, "Must be positive");
const nonnegative = decimal.refine((v) => Number(v) >= 0, "Must not be negative");
const field = z.object({ state: z.enum(["value", "not_stated", "not_applicable", "ambiguous"]), value: text.nullable(), raw: text.nullable().optional(), sourceIds: z.array(z.string()).max(500).optional(), origin: z.enum(["supplier", "calculated", "user"]).optional() });
const member = z.object({ quotationId: z.string().max(200), itemId: z.string().max(200) });
const group = z.object({ id: z.string().max(300), label: text, members: z.array(member).min(1).max(20), classification: z.enum(["equivalent", "alternative", "not_comparable"]), status: z.enum(["proposed", "approved", "rejected", "stale"]), explanation: text, sourceIds: z.array(z.string()).max(1000), requiredQuantity: positive, requiredUnit: z.string().max(100), acceptedOrderQuantities: z.record(z.string(), positive), billingPeriods: positive.nullable(), requirements: text, approvedRevision: z.number().int().nullable() });
const patch = z.object({ baseRevision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120).optional(), description: text.optional(), groups: z.array(group).max(500).optional(), exchangeRates: z.array(z.object({ id: z.string().max(200), from: z.string().regex(/^[A-Z]{3}$/), to: z.string().regex(/^[A-Z]{3}$/), rate: positive, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().min(1).max(1000) })).max(20).optional(), preferences: z.object({ priority: z.enum(["cost", "lead_time", "requirements"]), notes: text }).optional() });
const correction = z.object({ baseRevision: z.number().int().nonnegative(), quotationId: z.string().max(200), path: z.string().min(1).max(500), after: field, reason: z.string().trim().min(1).max(1000) });
const inputItem = z.object({ baseRevision: z.number().int().nonnegative(), quotationId: z.string().max(200), reason: z.string().trim().min(1).max(1000), item: z.object({ description: z.string().trim().min(1).max(1000), quantity: positive, unit: z.string().min(1).max(100), unitPrice: nonnegative, currency: z.string().regex(/^[A-Z]{3}$/), kind: z.enum(["goods", "service", "mixed", "unknown"]), billingBasis: z.string().max(200).optional(), scope: text.optional(), sourceIds: z.array(z.string().min(1).max(500)).max(100).optional(), taxBasis: z.enum(["inclusive", "exclusive", "not_stated"]).optional(), taxRate: nonnegative.refine((value) => Number(value) <= 100, "Tax rate must be at most 100 percent").optional() }) });
const extensionTypes: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain" };

export async function body(request: Request): Promise<unknown> {
  const limit = 2 * 1024 * 1024, length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new ApiError(400, "invalid_length", "The submitted request has an invalid length.");
  if (length !== null && Number(length) > limit) throw new ApiError(413, "input_too_large", "The submitted data is too large.");
  if (!request.body) throw new ApiError(400, "invalid_json", "The request contains invalid JSON.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const result = await reader.read(); signal.throwIfAborted();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { cancel(); throw new ApiError(413, "input_too_large", "The submitted data is too large."); }
      chunks.push(result.value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { throw new ApiError(400, "invalid_json", "The request contains invalid UTF-8 JSON."); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted) { cancel(); throw new ApiError(408, "input_timeout", "The request was interrupted or took too long. Retry the action."); }
    throw new ApiError(400, "invalid_json", "The request could not be read as JSON.");
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
function runLocal(context: RequestContext) { if (context.repository.mode === "local") startLocalRunner(context.repository as LocalRepository); }
async function loaded(context: RequestContext, comparisonId: string) { id.parse(comparisonId); return (await hydrateComparison(context.repository, await context.repository.get(context.ownerId, comparisonId))).comparison; }
function expectRevision(comparison: Comparison, revision: number) { if (comparison.revision !== revision) throw new ApiError(409, "stale_revision", "This comparison changed. Reload it before saving your edits."); }

export async function status(request: Request) {
  checkRequestBoundary(request, configuration().local);
  try { const context = await authorize(request); runLocal(context); return json({ ...capabilities(true), user: context.user }); }
  catch (error) { if (error instanceof ApiError && [401,403,503].includes(error.status)) return json({ ...capabilities(), ...(error.status !== 503 ? { accessMessage: error.message } : {}) }); throw error; }
}
export async function listComparisons(request: Request) {
  const context = await authorize(request); runLocal(context); const comparisons = await context.repository.list(context.ownerId);
  return json({ comparisons: await Promise.all(comparisons.map(async (c) => (await hydrateComparison(context.repository, c)).comparison)) });
}
export async function createComparison(request: Request) {
  const context = await authorize(request); const input = z.object({ name: z.string().trim().min(1).max(120), description: text.optional() }).parse(await body(request));
  const now = new Date().toISOString();
  const comparison: Comparison = { id: randomUUID(), workspaceId: context.workspaceId, name: input.name, description: input.description ?? "", createdAt: now, updatedAt: now, revision: 0, isDemo: false, quotations: [], groups: [], corrections: [], exchangeRates: [], preferences: { priority: "cost", notes: "" } };
  await context.repository.create(context.ownerId, comparison); return json({ comparison }, 201);
}
export async function getComparison(request: Request, comparisonId: string) { const context = await authorize(request); id.parse(comparisonId); runLocal(context); return json(await hydrateComparison(context.repository, await context.repository.get(context.ownerId, comparisonId))); }
export async function updateComparison(request: Request, comparisonId: string) {
  const context = await authorize(request); const input = patch.parse(await body(request)); const comparison = await loaded(context, comparisonId); expectRevision(comparison, input.baseRevision);
  if (input.groups) validateGroups(comparison, input.groups);
  const { baseRevision, ...changes } = input; const result = { ...comparison, ...changes };
  await context.repository.save(context.ownerId, result, baseRevision); return json({ comparison: await context.repository.get(context.ownerId, comparisonId) });
}
function validateGroups(comparison: Comparison, groups: MatchGroup[]) {
  const used = new Set<string>(); const ids = new Set<string>(); const availableSources = new Set(comparison.quotations.flatMap((q) => q.sources.map((s) => s.id)));
  for (const next of groups) {
    if (ids.has(next.id)) throw new ApiError(400, "duplicate_group", "Match group identifiers must be unique."); ids.add(next.id);
    const suppliers = new Set<string>();
    for (const item of next.members) {
      const quotation = comparison.quotations.find((q) => q.id === item.quotationId);
      if (!quotation?.items.some((i) => i.id === item.itemId)) throw new ApiError(400, "invalid_match", "A match references a missing quotation line.");
      const key = `${item.quotationId}:${item.itemId}`;
      if (next.status !== "rejected" && used.has(key)) throw new ApiError(400, "duplicate_match", "A source line can contribute to only one active match group.");
      if (next.status !== "rejected") used.add(key);
      if (suppliers.has(item.quotationId)) throw new ApiError(400, "bundle_unsupported", "A group can contain one indivisible price line per quotation. Bundle allocation is not supported."); suppliers.add(item.quotationId);
    }
    if (next.sourceIds.some((s) => !availableSources.has(s))) throw new ApiError(400, "invalid_source", "A match cites an unavailable source.");
    if (Object.keys(next.acceptedOrderQuantities).some((q) => !suppliers.has(q))) throw new ApiError(400, "invalid_quantity", "An accepted order quantity references a missing supplier.");
    if (next.billingPeriods && !/^\d+$/.test(next.billingPeriods)) throw new ApiError(400, "invalid_period", "Use a whole number of billing periods.");
    const before = comparison.groups.find((g) => g.id === next.id);
    const fingerprint = (g: MatchGroup) => JSON.stringify([g.members, g.requiredQuantity, g.requiredUnit, g.billingPeriods, g.requirements, g.classification, g.acceptedOrderQuantities]);
    if (next.status === "approved") {
      if (before?.status === "approved" && fingerprint(before) !== fingerprint(next)) { next.status = "stale"; next.approvedRevision = null; }
      else next.approvedRevision = comparison.revision + 1;
    } else next.approvedRevision = null;
  }
}
export async function deleteComparison(request: Request, comparisonId: string) { const context = await authorize(request); id.parse(comparisonId); await context.repository.remove(context.ownerId, comparisonId); return new Response(null, { status: 204 }); }
export async function deleteDocument(request: Request, documentId: string) {
  const context = await authorize(request); id.parse(documentId); const { baseRevision } = z.object({ baseRevision: z.number().int().nonnegative() }).parse(await body(request));
  const document = await context.repository.document(context.ownerId, documentId); await context.repository.removeDocument(context.ownerId, documentId, baseRevision);
  return json({ comparison: await context.repository.get(context.ownerId, document.comparisonId) });
}
export async function correctField(request: Request, comparisonId: string) {
  const context = await authorize(request); const input = correction.parse(await body(request)); const comparison = await loaded(context, comparisonId); expectRevision(comparison, input.baseRevision);
  const quotation = comparison.quotations.find((q) => q.id === input.quotationId);
  if (!quotation) throw new ApiError(404, "not_found", "Quotation not found.");
  let result: Comparison;
  try { result = applyCorrection(comparison, { quotationId: input.quotationId, path: input.path, value: input.after.value, state: input.after.state, reason: input.reason, author: context.user.id, baseVersion: input.baseRevision }); }
  catch (error) { throw new ApiError(400, "invalid_correction", error instanceof Error ? error.message : "Invalid correction."); }
  result.quotations = result.quotations.map((q) => q.id === input.quotationId ? reconcileQuotation(invalidateManualReview(q)) : q);
  await context.repository.save(context.ownerId, result, input.baseRevision); return json({ comparison: await context.repository.get(context.ownerId, comparisonId) });
}
export async function addItem(request: Request, comparisonId: string) {
  const context = await authorize(request); const input = inputItem.parse(await body(request)); const comparison = await loaded(context, comparisonId); expectRevision(comparison, input.baseRevision);
  const quotation = comparison.quotations.find((q) => q.id === input.quotationId); if (!quotation) throw new ApiError(404, "not_found", "Quotation not found.");
  if (quotation.items.length >= LIMITS.items) throw new ApiError(413, "item_limit", "This quotation has reached the supported line limit.");
  const sourceIds = [...new Set(input.item.sourceIds ?? [])];
  const availableSources = new Set(quotation.sources.filter((source) => source.documentId === quotation.documentId).map((source) => source.id));
  if (sourceIds.some((sourceId) => !availableSources.has(sourceId))) throw new ApiError(400, "invalid_source", "Choose evidence from this quotation's preserved source only.");
  const item = emptyItem(randomUUID()); item.kind = input.item.kind; item.taxBasis = input.item.taxBasis ?? "not_stated"; item.sourceIds = sourceIds; const now = new Date().toISOString();
  for (const key of ["description", "quantity", "unit", "unitPrice", "currency", "billingBasis", "scope", "taxRate"] as const) {
    const value = input.item[key]; if (value === undefined) continue;
    const after: FieldValue = { state: "value", value, raw: value, sourceIds: [...sourceIds], origin: "user" }; item[key] = after;
    comparison.corrections.push({ id: randomUUID(), operation: "add_item", quotationId: quotation.id, path: `items.${item.id}.${key}`, before: absent(), after, author: context.user.id, createdAt: now, reason: `Added source line manually: ${input.reason}`, baseVersion: input.baseRevision });
  }
  for (const key of ["kind", "taxBasis"] as const) {
    const value = input.item[key]; if (value === undefined) continue;
    comparison.corrections.push({ id: randomUUID(), operation: "add_item", quotationId: quotation.id, path: `items.${item.id}.${key}`, before: absent(), after: { state: "value", value, raw: null, sourceIds: [...sourceIds], origin: "user" }, author: context.user.id, createdAt: now, reason: `Added source line manually: ${input.reason}`, baseVersion: input.baseRevision });
  }
  quotation.items.push(item); invalidateManualReview(quotation); quotation.status = "partial";
  comparison.quotations = comparison.quotations.map((q) => q.id === quotation.id ? reconcileQuotation(q) : q);
  for (const g of comparison.groups) if (g.status === "approved") { g.status = "stale"; g.approvedRevision = null; }
  await context.repository.save(context.ownerId, comparison, input.baseRevision); return json({ comparison: await context.repository.get(context.ownerId, comparisonId) });
}
export async function acknowledgeIssue(request: Request, comparisonId: string) {
  const context = await authorize(request); const input = z.object({ baseRevision: z.number().int().nonnegative(), quotationId: z.string(), issueId: z.string(), reason: z.string().trim().min(1).max(1000) }).parse(await body(request));
  const comparison = await loaded(context, comparisonId); expectRevision(comparison, input.baseRevision);
  const quotation = comparison.quotations.find((q) => q.id === input.quotationId);
  const issue = quotation?.issues.find((i) => i.id === input.issueId);
  if (!issue) throw new ApiError(404, "not_found", "This review issue is unavailable.");
  if (quotation && issue.id === `${quotation.id}:manual-review` && (!hasCompleteSourceCoverage(quotation) || !quotation.items.length || quotation.supplier.name.state !== "value" || !quotation.supplier.name.value?.trim())) {
    throw new ApiError(422, "manual_review_incomplete", "Before confirming review, enter the supplier name and at least one line item, and recover any unreadable source sections.");
  }
  issue.resolved = true; issue.resolution = `Acknowledged by ${context.user.id} at ${new Date().toISOString()}: ${input.reason}`;
  await context.repository.save(context.ownerId, comparison, input.baseRevision); return json({ comparison: await loaded(context, comparisonId) });
}
function invalidateManualReview(quotation: ReturnType<typeof emptyQuotation>) {
  const review = quotation.issues.find(issue => issue.id === `${quotation.id}:manual-review`);
  if (review) { review.resolved = false; delete review.resolution; quotation.status = "source_ready"; }
  // Close only deterministic missing-data notices whose specific condition was fixed.
  // Original model uncertainties and parser coverage issues still need buyer review.
  for (const issue of quotation.issues) {
    const rowsEntered = quotation.items.length > 0 && issue.code === "incomplete_extraction" && issue.message === "No line items were extracted. Supply clearer text or review the source manually.";
    const supplierEntered = quotation.supplier.name.state === "value" && Boolean(quotation.supplier.name.value?.trim()) && issue.code === "missing_field" && issue.fieldPath === "supplier.name" && (issue.message === "Supplier name needs review." || issue.id === `${quotation.id}:manual-supplier`);
    if (rowsEntered || supplierEntered) { issue.resolved = true; issue.resolution = "Addressed by a recorded manual entry or correction."; }
  }
  return quotation;
}
function uploadMode(value?: unknown): ProcessingMode {
  const state = capabilities(true);
  const mode = z.enum(["parse_only", "ai"]).parse(value ?? state.processingMode);
  if (mode === "ai" && !state.canExtract) throw new ApiError(503, "ai_unavailable", "AI interpretation is disabled. Choose source parsing and manual review.");
  return mode;
}
function fileMetadata(filename: string, size: number) {
  if (!filename || filename.length > 240 || /[\x00-\x1f]/.test(filename)) throw new ApiError(400, "filename", "Choose a file with a valid name.");
  const sanitized = filename.split(/[\\/]/).at(-1)!; const extension = sanitized.split(".").at(-1)!.toLowerCase(); const contentType = extensionTypes[extension];
  if (!contentType) throw new ApiError(415, "unsupported_format", "Use a PDF, PNG, JPEG, XLSX, CSV or pasted quotation text. DOCX and legacy XLS are not supported yet.");
  if (size <= 0 || size > LIMITS.fileBytes) throw new ApiError(413, "file_size", "Upload a nonempty file of at most 20 MB, or split it into smaller files.");
  return { filename: sanitized, contentType };
}
function newRun(context: RequestContext, comparison: Comparison, document: DocumentRecord): RunRecord {
  const now = new Date().toISOString(); return { id: randomUUID(), comparisonId: comparison.id, documentId: document.id, ownerId: context.ownerId, processingMode: document.processingMode ?? "parse_only", stage: "queued", progress: 0, attempt: 0, fence: randomUUID(), inputRevision: comparison.revision, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: document.contentHash };
}
function assertUploads(context: RequestContext) {
  const state = capabilities(true); if (!state.canUpload) throw new ApiError(503, "processing_unavailable", state.reasons.join(" "));
  if (context.repository.mode === "local") return;
}
async function checkUpload(context: RequestContext, comparison: Comparison, hash: string, allowDuplicate: boolean, supersedesId?: string) {
  if (comparison.quotations.length >= LIMITS.files) throw new ApiError(413, "file_limit", "This comparison supports up to five quotations. Create another comparison for more suppliers.");
  if (supersedesId && !comparison.quotations.some((q) => q.id === supersedesId)) throw new ApiError(400, "invalid_revision", "The quotation being revised is not in this comparison.");
  const duplicate = await context.repository.findDuplicate(context.ownerId, comparison.id, hash);
  if (duplicate && !allowDuplicate) throw new ApiError(409, "duplicate", "This exact file is already in the comparison. Open it or upload it intentionally as a separate quotation revision.", { documentId: duplicate.id });
}
/** Admission appends one stable document to the newest snapshot. Recheck limits and
 * duplicates after CAS conflicts without resubmitting or overwriting buyer edits. */
async function admitUpload(context: RequestContext, document: DocumentRecord, run: RunRecord | null, quotation: ReturnType<typeof emptyQuotation>, allowDuplicate: boolean) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const latest = await context.repository.get(context.ownerId, document.comparisonId);
    await checkUpload(context, latest, document.contentHash, allowDuplicate, document.supersedesId);
    if (run) run.inputRevision = latest.revision;
    try { await context.repository.createUpload(context.ownerId, document, run, quotation, latest.revision); return; }
    catch (error) { if (!(error instanceof ApiError && error.code === "stale_revision") || attempt === 7) throw error; }
  }
}
export async function upload(request: Request, comparisonId: string) {
  const context = await authorize(request); assertUploads(context); const comparison = await loaded(context, comparisonId);
  let filename: string; let bytes: Uint8Array; let allowDuplicate = false; let supersedesId: string | undefined; let processingMode: ProcessingMode;
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    if (context.repository.mode !== "local") throw new ApiError(400, "direct_upload_required", "Use the private direct-upload flow for files on the hosted application.");
    if (Number(request.headers.get("content-length") ?? 0) > LIMITS.fileBytes + 65536) throw new ApiError(413, "file_size", "This file exceeds 20 MB.");
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "missing_file", "Choose one quotation file.");
    processingMode = uploadMode(form.get("processingMode") ?? undefined);
    fileMetadata(file.name, file.size); filename = file.name; bytes = new Uint8Array(await file.arrayBuffer()); allowDuplicate = form.get("allowDuplicate") === "true"; supersedesId = typeof form.get("supersedesId") === "string" ? String(form.get("supersedesId")) || undefined : undefined;
  } else {
    const input = z.object({ text: z.string().trim().min(1).max(LIMITS.textChars), filename: z.string().max(200).optional(), allowDuplicate: z.boolean().optional(), supersedesId: z.string().optional(), processingMode: z.enum(["parse_only", "ai"]).optional() }).parse(await body(request));
    processingMode = uploadMode(input.processingMode);
    filename = input.filename?.endsWith(".txt") ? input.filename : `${input.filename || "Pasted quotation"}.txt`; bytes = new TextEncoder().encode(input.text); allowDuplicate = input.allowDuplicate ?? false; supersedesId = input.supersedesId;
  }
  const metadata = fileMetadata(filename, bytes.byteLength); const hash = createHash("sha256").update(bytes).digest("hex");
  if (context.repository.mode === "cloud") {
    const unfinished = !allowDuplicate ? await context.repository.findDuplicate(context.ownerId, comparisonId, hash) : null;
    const resumable = unfinished?.status === "uploading" && unfinished.filename === metadata.filename && unfinished.size === bytes.byteLength
      && unfinished.contentType === metadata.contentType && (unfinished.processingMode ?? "parse_only") === processingMode && unfinished.supersedesId === supersedesId;
    const document: DocumentRecord = resumable ? unfinished : { id: randomUUID(), comparisonId, ownerId: context.ownerId, ...metadata, contentHash: hash, size: bytes.byteLength,
      storagePath: "", createdAt: new Date().toISOString(), status: "uploading", supersedesId, processingMode };
    if (!resumable) {
      document.storagePath = `${context.ownerId}/${document.id}`;
      // Persist the private source intent before writing any bytes. If storage
      // fails, its existing record remains available for retry or deletion.
      await admitUpload(context, document, null, { ...emptyQuotation(document.id, metadata.filename), contentHash: hash, supersedesId }, allowDuplicate);
    }
    const candidate = newRun(context, comparison, document);
    try {
      await context.repository.writeObject(document, bytes);
      await context.repository.finalizeUpload(context.ownerId, document.id, hash, candidate);
    } catch (error) {
      // A concurrent deletion already owns a durable outbox entry. Best-effort
      // removal closes the race quickly; failed removal remains retryable there.
      if (error instanceof ApiError && error.code === "not_found") await context.repository.deleteObject(document).catch(() => console.info(JSON.stringify({ event: "late_upload_cleanup_failed", documentId: document.id })));
      throw error;
    }
    const run = (await context.repository.runs(context.ownerId, comparisonId)).find(entry => entry.documentId === document.id);
    if (!run) throw new ApiError(503, "dispatch_pending", "The source is saved but its processing record could not be read. Open this comparison to retry processing.");
    await dispatchRun(context.repository, run);
    return json({ run, documentId: document.id, comparison: await context.repository.get(context.ownerId, comparisonId) }, 202);
  }
  await checkUpload(context, comparison, hash, allowDuplicate, supersedesId);
  const document: DocumentRecord = { id: randomUUID(), comparisonId, ownerId: context.ownerId, ...metadata, contentHash: hash, size: bytes.byteLength, storagePath: "", createdAt: new Date().toISOString(), status: "uploaded", supersedesId, processingMode };
  document.storagePath = `${context.ownerId}/${document.id}`; const run = newRun(context, comparison, document); const quotation = { ...emptyQuotation(document.id, metadata.filename), contentHash: hash, supersedesId };
  await context.repository.writeObject(document, bytes);
  try { await admitUpload(context, document, run, quotation, allowDuplicate); }
  catch (error) { await context.repository.deleteObject(document).catch(() => {}); throw error; }
  await dispatchRun(context.repository, run);
  return json({ run, documentId: document.id, comparison: await context.repository.get(context.ownerId, comparisonId) }, 202);
}
export async function initiateUpload(request: Request, comparisonId: string) {
  // Anchor URL expiry before the ownership lookup so a signer delayed across
  // deletion cannot outlive the deletion outbox's six-minute replay window.
  const requestedAt = new Date();
  const context = await authorize(request); assertUploads(context); if (context.repository.mode !== "cloud") throw new ApiError(400, "local_multipart", "Local uploads use the multipart upload endpoint.");
  const input = z.object({ filename: z.string(), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), allowDuplicate: z.boolean().optional(), supersedesId: z.string().optional(), processingMode: z.enum(["parse_only", "ai"]).optional() }).parse(await body(request));
  const processingMode = uploadMode(input.processingMode);
  const comparison = await loaded(context, comparisonId); const metadata = fileMetadata(input.filename, input.size);
  const unfinished = !input.allowDuplicate ? await context.repository.findDuplicate(context.ownerId, comparisonId, input.sha256) : null;
  if (unfinished?.status === "uploading" && unfinished.filename === metadata.filename && unfinished.size === input.size && unfinished.contentType === metadata.contentType
    && (unfinished.processingMode ?? "parse_only") === processingMode && unfinished.supersedesId === input.supersedesId) {
    // Retry the existing intent rather than losing another slot or asking the buyer
    // to delete the work preserved after an interrupted PUT/finalize response.
    const ticket = await storageUploadIntent(unfinished, requestedAt);
    return json({ documentId: unfinished.id, ...ticket, contentType: unfinished.contentType, resumed: true }, 200);
  }
  await checkUpload(context, comparison, input.sha256, input.allowDuplicate ?? false, input.supersedesId);
  const document: DocumentRecord = { id: randomUUID(), comparisonId, ownerId: context.ownerId, ...metadata, contentHash: input.sha256, size: input.size, storagePath: "", createdAt: new Date().toISOString(), status: "uploading", supersedesId: input.supersedesId, processingMode }; document.storagePath = `${context.ownerId}/${document.id}`;
  await admitUpload(context, document, null, { ...emptyQuotation(document.id, metadata.filename), contentHash: input.sha256, supersedesId: input.supersedesId }, input.allowDuplicate ?? false);
  const ticket = await storageUploadIntent(document, requestedAt);
  return json({ documentId: document.id, ...ticket, contentType: metadata.contentType }, 201);
}
export async function finalizeUpload(request: Request, documentId: string) {
  const context = await authorize(request); assertUploads(context); id.parse(documentId); const document = await context.repository.document(context.ownerId, documentId); const comparison = await loaded(context, document.comparisonId);
  if (document.status === "uploaded") { const runs = await context.repository.runs(context.ownerId, document.comparisonId); return json({ run: runs.find((r) => r.documentId === documentId), documentId, comparison }, 202); }
  const bytes = context.repository.mode === "cloud" ? await storageFinalizeUpload(document) : await context.repository.readObject(document); const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== document.size || hash !== document.contentHash) throw new ApiError(422, "integrity_check", "Uploaded bytes do not match the selected file. Delete this upload and try again.");
  const candidate = newRun(context, comparison, document);
  try { await context.repository.finalizeUpload(context.ownerId, documentId, hash, candidate); }
  catch (error) {
    // Deletion can race the object promotion. Remove bytes created after the
    // deletion outbox ran; preserve bytes for ordinary retryable DB failures.
    if (error instanceof ApiError && error.code === "not_found") await context.repository.deleteObject(document).catch(() => console.info(JSON.stringify({ event: "late_upload_cleanup_failed", documentId })));
    throw error;
  }
  // Another finalize may have won the transaction. Dispatch and return the actual
  // persisted job, never the losing caller's freshly generated candidate ID.
  const run = (await context.repository.runs(context.ownerId, document.comparisonId)).find((entry) => entry.documentId === documentId);
  if (!run) throw new ApiError(503, "dispatch_pending", "The upload is saved but its processing record could not be read. Retry finalization.");
  if (context.repository.mode === "cloud") await storageDiscardUpload(document).catch(() => console.info(JSON.stringify({ event: "staged_upload_cleanup_failed", documentId })));
  await dispatchRun(context.repository, run); return json({ run, documentId, comparison: await context.repository.get(context.ownerId, document.comparisonId) }, 202);
}
export async function getRun(request: Request, runId: string) { const context = await authorize(request); id.parse(runId); runLocal(context); return json({ run: await context.repository.run(context.ownerId, runId) }); }
export async function cancelRun(request: Request, runId: string) {
  const context = await authorize(request); id.parse(runId); const run = await context.repository.run(context.ownerId, runId);
  if (["ready", "partial", "source_ready"].includes(run.stage)) throw new ApiError(409, "run_complete", "This file has finished processing.");
  const next: RunRecord = { ...run, cancelRequested: true, stage: "cancelled", message: "Processing cancelled. The original file remains available." };
  await context.repository.saveRun(next, run.fence);
  if (run.taskRunId && context.repository.mode === "cloud") { const { runs } = await import("@trigger.dev/sdk"); await runs.cancel(run.taskRunId).catch(() => {}); }
  return json({ run: await context.repository.run(context.ownerId, runId) });
}
export async function retryRun(request: Request, runId: string) { const context = await authorize(request); assertUploads(context); id.parse(runId); const run = await context.repository.retryRun(context.ownerId, runId); await dispatchRun(context.repository, run); return json({ run }, 202); }
export async function source(request: Request, documentId: string) {
  const context = await authorize(request); id.parse(documentId); const document = await context.repository.document(context.ownerId, documentId);
  if (document.status !== "uploaded") throw new ApiError(409, "source_uploading", "This source has not finished uploading.");
  if (context.repository.mode === "cloud") {
    const signedUrl = await storageSourceUrl(document);
    return new Response(null, { status: 302, headers: { Location: signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
  const bytes = await context.repository.readObject(document); const inline = ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(document.contentType);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": document.contentType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.filename)}`, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
}
export async function proposeGroups(request: Request, comparisonId: string) {
  const context = await authorize(request); const input = z.object({ baseRevision: z.number().int().nonnegative(), mode: z.enum(["baseline", "ai"]) }).parse(await body(request));
  const comparison = await loaded(context, comparisonId); expectRevision(comparison, input.baseRevision);
  let groups: MatchGroup[];
  if (input.mode === "baseline") {
    const { proposeMatches } = await import("@/lib/domain/matching"); groups = proposeMatches(comparison.quotations);
    groups = groups.map((group) => ({ ...group, explanation: `Identifier/text baseline (not AI). ${group.explanation}` }));
  } else {
    if (!configuration().model) throw new ApiError(503, "ai_unavailable", "AI matching is disabled. Use the labelled identifier/text baseline or group source lines manually.");
    const { proposeAIMatches } = await import("@/lib/ai");
    try { groups = await proposeAIMatches(comparison.quotations, { signal: AbortSignal.timeout(60000) }); }
    catch (error) { const detail = error as { code?: string; message?: string }; throw new ApiError(detail.code === "quota" ? 429 : 422, detail.code ?? "matching_failed", detail.message ?? "Semantic matching failed. Your existing groups were preserved."); }
  }
  validateGroups(comparison, groups); comparison.groups = groups;
  await context.repository.save(context.ownerId, comparison, input.baseRevision);
  return json({ comparison: await context.repository.get(context.ownerId, comparisonId), method: input.mode });
}
