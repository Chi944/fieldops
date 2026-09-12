import { randomUUID, createHash } from "node:crypto";
import type { ParsedDocument, ProcessingStage, Quotation } from "@/lib/domain/types";
import type { Repository, RunRecord } from "./contracts";
import { LocalRepository } from "./local-repository";
import { CloudRepository } from "./cloud-repository";
import { configuration } from "./config";
import { ApiError } from "./errors";

const leases = () => new Date(Date.now() + 30000).toISOString();
interface Pump { running: boolean; stopping?: boolean; idle?: Promise<void>; timer?: ReturnType<typeof setInterval>; }
const runtime = globalThis as typeof globalThis & { __fieldopsPumps?: Map<string, Pump> };
runtime.__fieldopsPumps ??= new Map();
export function hasCompleteSourceCoverage(document: Pick<ParsedDocument, "manifest" | "sources">): boolean {
  return document.manifest.complete && document.sources.length > 0 && document.manifest.units.every((unit) => unit.status === "parsed" || unit.status === "empty");
}
function partialSourceMessage(document: ParsedDocument): string {
  const unread = document.manifest.units.filter((unit) => unit.status === "failed" || unit.status === "unsupported").map((unit) => `${unit.label}${unit.message ? `: ${unit.message}` : ""}`);
  return `Some source sections could not be read${unread.length ? ` (${unread.join("; ")})` : ""}. Review the preserved sections and upload a clearer copy of missing content. No AI extraction was performed.`;
}

/** Production Trigger and the local runner execute this same source-to-review pipeline. */
export async function executeRun(repository: Repository, id: string): Promise<void> {
  let run = await repository.claimRun(id, randomUUID(), leases());
  if (!run) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), 10 * 60 * 1000);
  let lastProgress = 0;
  let heartbeatWork: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatWork || !run) return;
    heartbeatWork = (async () => {
      try {
        const current = await repository.run(run.ownerId, run.id);
        if (current.cancelRequested || current.fence !== run.fence) { controller.abort(); return; }
        if (!await repository.renewLease(run.id, run.fence, leases())) controller.abort();
      } catch { controller.abort(); }
    })().finally(() => { heartbeatWork = undefined; });
  }, 1000);
  // Parser callbacks do not await progress persistence. Serialize their writes so a
  // slow callback cannot overwrite a later extraction stage or terminal failure.
  let progressWrites: Promise<void> = Promise.resolve();
  const update = (stage: ProcessingStage, progress: number, message: string, terminal = false) => progressWrites = progressWrites.then(async () => {
    if (!run || controller.signal.aborted) throw new ApiError(409, "cancelled", "Processing was cancelled.");
    run = { ...run, stage, progress, message, leaseUntil: terminal ? undefined : leases(), ...(terminal ? { errorCode: undefined, retryAfter: undefined, retryable: false } : {}) };
    if (!await repository.saveRun(run, run.fence)) { controller.abort(); throw new ApiError(409, "cancelled", "Processing was superseded or cancelled."); }
  });
  try {
    if (run.attempt > 2) throw new ApiError(422, "interrupted_limit", "Processing was interrupted twice. Retry the file explicitly to continue from saved work.");
    const document = await repository.document(run.ownerId, run.documentId);
    // Processing consent belongs to the persisted upload, not current server
    // defaults or provider availability. A retry cannot promote parser-only work.
    if (!["parse_only", "ai"].includes(run.processingMode) || run.processingMode !== (document.processingMode ?? "parse_only")) throw new ApiError(409, "processing_mode_mismatch", "This run does not match the processing mode selected for its upload. Upload the document again with the intended mode.");
    const bytes = await repository.readObject(document);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== run.expectedHash) throw new ApiError(422, "source_changed", "The uploaded source failed its integrity check. Upload it again.");
    const { parseDocument } = await import("@/lib/processing");
    let parsed = await repository.getParsed(document.id);
    if (!parsed || parsed.contentHash !== actualHash) {
      await update("parsing", 10, "Reading the original document and preserving source locations.");
      parsed = await parseDocument({ documentId: document.id, filename: document.filename, bytes, signal: controller.signal, onProgress: (event) => {
        if (Date.now() - lastProgress > 500) { lastProgress = Date.now(); void update("parsing", Math.min(55, 10 + event.progress * 0.45), event.message).catch(() => {}); }
      } });
      await repository.saveParsed(run, parsed);
    }
    if (run.processingMode === "parse_only") {
      const complete = hasCompleteSourceCoverage(parsed);
      await update(complete ? "source_ready" : "partial", 100, complete
        ? "Source parsing finished. Enter quotation details and confirm you have reviewed every source section; no AI extraction was performed."
        : partialSourceMessage(parsed), true);
      return;
    }
    await update("extracting", 60, "Interpreting quotation fields against the preserved source evidence.");
    if (!configuration().model) throw new ApiError(503, "ai_unavailable", "AI interpretation is disabled. The source was preserved for manual review. This run retains its selected AI mode and can be retried explicitly after AI is enabled.");
    const { extractQuotation } = await import("@/lib/ai");
    const quotation = await extractQuotation(parsed, { signal: controller.signal, extractionVersion: run.extractionVersion, checkpoint: {
      get: async (key) => await repository.getCheckpoint(document.id, key) as import("@/lib/ai").AIResult | null,
      set: async (key, value) => { if (run) await repository.saveCheckpoint(run, key, value); },
      reject: async (key, result, code, context) => {
        if (run && !controller.signal.aborted) await repository.saveCheckpoint(run, `rejected:${key}:${Date.now()}:${randomUUID()}`, {
          requestKey: key, code, cached: context?.cached ?? false, result, runId: run.id, extractionVersion: run.extractionVersion, createdAt: new Date().toISOString(),
        });
      },
    } });
    await update("reconciling", 90, "Checking quantities, amounts, totals and extraction coverage.");
    const { reconcileQuotation } = await import("@/lib/domain/validation");
    const reviewed = reconcileQuotation({ ...quotation, extractionVersion: run.extractionVersion, isDemo: false, sourceUrl: `/api/documents/${document.id}/source`, supersedesId: document.supersedesId });
    reviewed.status = reviewed.manifest.complete && !reviewed.issues.some((issue) => issue.code === "incomplete_extraction" && !issue.resolved) ? "ready" : "partial";
    await repository.complete(run, reviewed);
  } catch (error) {
    await progressWrites.catch(() => {});
    const detail = error as { code?: string; retryable?: boolean; message?: string; retryAfterMs?: number };
    const current = run ? await repository.run(run.ownerId, run.id).catch(() => null) : null;
    if (!current || !run || current.fence !== run.fence) return;
    const cancelled = current.cancelRequested || (controller.signal.aborted && controller.signal.reason?.message !== "timeout");
    const code = cancelled ? "cancelled" : controller.signal.aborted ? "timeout" : detail.code ?? "processing_failed";
    const safeMessage = detail.code ? detail.message : "Processing failed. Your source and completed stages were preserved. Retry this file.";
    const aiMode = current.processingMode === "ai";
    const retry = aiMode && !cancelled && detail.retryable && code !== "quota" && current.attempt < 2;
    const waitingQuota = aiMode && code === "quota";
    const quotaWaits = (current.quotaWaits ?? 0) + (waitingQuota ? 1 : 0);
    const retryAfter = waitingQuota && quotaWaits <= 20 ? new Date(Date.now() + Math.max(5000, Number.isFinite(detail.retryAfterMs) ? detail.retryAfterMs! : 60000)).toISOString() : undefined;
    await repository.saveRun({ ...current, stage: cancelled ? "cancelled" : waitingQuota ? "waiting_quota" : retry ? "queued" : "failed", cancelRequested: cancelled, errorCode: code,
      message: cancelled ? "Processing cancelled. The original file remains available." : code === "timeout" ? "Processing exceeded its time limit. Split the document and retry." : waitingQuota ? retryAfter ? `Waiting for the free model quota. Processing will resume from saved chunks after ${retryAfter}.` : "The free model quota has repeatedly blocked this file. Split it into smaller sections, or retry after the provider quota resets." : safeMessage,
      retryable: detail.retryable ?? false, retryAfter, quotaWaits, leaseUntil: retry ? new Date(Date.now() + 5000).toISOString() : undefined }, current.fence);
    console.info(JSON.stringify({ event: "processing_result", runId: current.id, code, attempt: current.attempt }));
  } finally {
    clearTimeout(timeout); clearInterval(heartbeat);
    // Clearing an interval does not finish a renewal already writing to the repository.
    await heartbeatWork;
  }
}

export function startLocalRunner(repository = new LocalRepository()) {
  const key = repository.directory;
  let pump = runtime.__fieldopsPumps!.get(key);
  if (!pump) { pump = { running: false }; runtime.__fieldopsPumps!.set(key, pump); }
  if (pump.stopping) return;
  const drain = () => {
    if (pump.running || pump.stopping) return; pump.running = true;
    pump.idle = (async () => {
      try {
        await repository.cleanup();
        // Drain uploads admitted during processing, but stop claiming new work during shutdown.
        while (!pump.stopping) {
          const pending = await repository.pendingRuns(); if (!pending.length) break;
          for (const run of pending) {
            if (pump.stopping) break;
            await executeRun(repository, run.id);
          }
        }
      }
      catch { console.error(JSON.stringify({ event: "local_worker_unavailable", code: "storage_or_worker_error" })); }
      finally { pump.running = false; }
    })();
  };
  if (!pump.timer) { pump.timer = setInterval(() => void drain(), 5000); pump.timer.unref?.(); }
  void drain();
}
/** Finish the active file and its writes; queued files remain durable for the next start. */
export async function stopLocalRunner(directory: string): Promise<void> {
  const pump = runtime.__fieldopsPumps!.get(directory); if (!pump) return;
  pump.stopping = true;
  if (pump.timer) clearInterval(pump.timer); pump.timer = undefined;
  await pump.idle;
  if (runtime.__fieldopsPumps!.get(directory) === pump) runtime.__fieldopsPumps!.delete(directory);
}
export async function dispatchRun(repository: Repository, run: RunRecord) {
  if (repository.mode === "local") { startLocalRunner(repository as LocalRepository); return; }
  if (!configuration().trigger) throw new ApiError(503, "worker_unconfigured", "The free background worker is not configured. The upload intent was saved.");
  const { tasks } = await import("@trigger.dev/sdk");
  try {
    const handle = await tasks.trigger("fieldops-process-document", { runId: run.id }, { idempotencyKey: `${run.id}:${run.fence}`, idempotencyKeyTTL: "30d" });
    const current = await repository.run(run.ownerId, run.id);
    if (current.fence === run.fence) await repository.saveRun({ ...current, taskRunId: handle.id, dispatchedAt: new Date().toISOString() }, current.fence);
  } catch {
    // The persistent run is the outbox. Scheduled reconciliation retries this stable idempotency key.
    const current = await repository.run(run.ownerId, run.id).catch(() => null);
    if (current?.fence === run.fence && current.stage === "queued") await repository.saveRun({ ...current, message: "Background dispatch is pending. Check the free worker configuration; dispatch will retry safely.", errorCode: "dispatch_pending" }, current.fence);
    console.info(JSON.stringify({ event: "dispatch_pending", runId: run.id }));
  }
}
export async function reconcileCloudJobs() {
  const repository = new CloudRepository();
  const deadline = Date.now() + 15000;
  // Dispatch saved work before optional object maintenance. A slow deletion must
  // not consume the scheduler's entire 20-second task and strand every upload.
  for (const run of await repository.pendingRuns()) {
    if (Date.now() >= deadline - 5000) break;
    if (run.dispatchedAt && Date.now() - Date.parse(run.dispatchedAt) < 12 * 60 * 1000) continue;
    await dispatchRun(repository, run);
  }
  const remaining = Math.min(5000, deadline - Date.now());
  if (remaining > 0) await repository.cleanup({ signal: AbortSignal.timeout(remaining) });
}
export async function hydrateComparison(repository: Repository, comparison: import("@/lib/domain/types").Comparison) {
  const runs = await repository.runs(comparison.workspaceId === "local-workspace" ? "local-user" : comparison.workspaceId, comparison.id);
  const quotations: Quotation[] = [];
  for (const quotation of comparison.quotations) {
    const run = runs.filter((r) => r.documentId === quotation.documentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (quotation.extractionVersion === 0) {
      const parsed = await repository.getParsed(quotation.documentId);
      const parseOnly = (run?.processingMode ?? "parse_only") === "parse_only";
      const issues = quotation.issues.filter((issue) => !parseOnly || issue.id !== `${quotation.id}:pending-extraction`);
      if (parsed && parseOnly) {
        if (!issues.some((issue) => issue.id === `${quotation.id}:manual-review`)) issues.push({ id: `${quotation.id}:manual-review`, code: "incomplete_extraction", severity: "warning", message: "Source parsing finished. Enter quotation details and confirm you have reviewed every source section; no AI extraction was performed.", documentId: quotation.documentId, sourceIds: [], resolved: false });
        if (!hasCompleteSourceCoverage(parsed) && !issues.some((issue) => issue.id === `${quotation.id}:parser-coverage`)) issues.push({ id: `${quotation.id}:parser-coverage`, code: "incomplete_extraction", severity: "error", message: partialSourceMessage(parsed), documentId: quotation.documentId, sourceIds: [], resolved: false });
        if (quotation.supplier.name.state !== "value" && !issues.some((issue) => issue.code === "missing_field" && issue.fieldPath === "supplier.name")) issues.push({ id: `${quotation.id}:manual-supplier`, code: "missing_field", severity: "warning", message: "Enter the supplier name from the original quotation.", documentId: quotation.documentId, fieldPath: "supplier.name", sourceIds: [], resolved: false });
      } else if (parsed && !issues.some((issue) => issue.id === `${quotation.id}:pending-extraction`)) issues.push({ id: `${quotation.id}:pending-extraction`, code: "incomplete_extraction", severity: "error", message: run?.message ?? "Source parsed; AI extraction is incomplete.", documentId: quotation.documentId, sourceIds: [], resolved: false });
      const sourceOnly = Boolean(parsed?.sources.length && (!run || ["failed", "cancelled", "waiting_quota", "partial"].includes(run.stage)));
      const manuallyReviewed = parseOnly && parsed && hasCompleteSourceCoverage(parsed) && quotation.items.length > 0 && quotation.supplier.name.state === "value" && Boolean(quotation.supplier.name.value?.trim()) && issues.some((issue) => issue.id === `${quotation.id}:manual-review` && issue.resolved);
      const status = manuallyReviewed ? "ready" : parseOnly && parsed && !hasCompleteSourceCoverage(parsed) ? "partial" : parseOnly && run?.stage === "source_ready" ? "source_ready" : quotation.items.length || sourceOnly ? "partial" : run?.stage ?? quotation.status;
      quotations.push({ ...quotation, ...(parsed ? { ...parsed } : {}), status, sourceUrl: `/api/documents/${quotation.documentId}/source`, issues });
    } else quotations.push(quotation);
  }
  return { comparison: { ...comparison, quotations }, runs };
}
