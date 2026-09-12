import type { Comparison, ParsedDocument, Quotation } from "@/lib/domain/types";
import type { Repository, DocumentRecord, RunRecord } from "./contracts";
import { ApiError } from "./errors";
import { sqlQuery } from "./neon-db";
import { storageWrite, storageRead, storageDelete } from "./neon-storage";

// Names are fixed application code, never user input; values use PostgreSQL parameters.
type RpcName = "create_comparison" | "save_comparison" | "delete_comparison" | "delete_document" | "create_upload" | "finalize_upload" | "pending_runs" | "save_run" | "claim_run" | "renew_lease" | "retry_run" | "save_parsed" | "save_checkpoint" | "complete_run";
async function rpc<T>(name: RpcName, params: unknown[] = []): Promise<T> {
  const rows = await sqlQuery<{ result: T }>(`select public.fieldops_${name}(${params.map((_, index) => `$${index + 1}`).join(",")}) as result`, params);
  return rows[0]?.result;
}
export class CloudRepository implements Repository {
  readonly mode = "cloud" as const;
  async list(ownerId: string) {
    const rows = await sqlQuery<{ snapshot: Comparison }>("select snapshot from public.comparisons where owner_id=$1 and deleted_at is null order by updated_at desc", [ownerId]);
    return rows.map(row => row.snapshot);
  }
  async get(ownerId: string, id: string) {
    const rows = await sqlQuery<{ snapshot: Comparison }>("select snapshot from public.comparisons where owner_id=$1 and id=$2 and deleted_at is null", [ownerId, id]);
    if (!rows[0]) throw new ApiError(404, "not_found", "This comparison is unavailable in your workspace.");
    return rows[0].snapshot;
  }
  async create(ownerId: string, comparison: Comparison) { await rpc("create_comparison", [ownerId, comparison]); }
  async save(ownerId: string, comparison: Comparison, expectedRevision: number) { await rpc("save_comparison", [ownerId, comparison, expectedRevision]); }
  async remove(ownerId: string, comparisonId: string) { await rpc("delete_comparison", [ownerId, comparisonId]); await this.cleanupAfterDeletion(); }
  async removeDocument(ownerId: string, documentId: string, expectedRevision: number) { await rpc("delete_document", [ownerId, documentId, expectedRevision]); await this.cleanupAfterDeletion(); }
  private async cleanupAfterDeletion() {
    // The transaction already removed private access and saved a durable outbox.
    // Bound this convenience sweep; maintenance failure must not undo its response.
    try { await this.cleanup({ signal: AbortSignal.timeout(3000) }); }
    catch { console.info(JSON.stringify({ event: "deletion_cleanup_pending" })); }
  }
  async createUpload(ownerId: string, document: DocumentRecord, run: RunRecord | null, quotation: Quotation, expectedRevision: number) { await rpc("create_upload", [ownerId, document, run, quotation, expectedRevision]); }
  async finalizeUpload(ownerId: string, documentId: string, hash: string, run: RunRecord) { await rpc("finalize_upload", [ownerId, documentId, hash, run]); }
  async document(ownerId: string, id: string) {
    const rows = await sqlQuery<{ record: DocumentRecord }>("select record from public.documents where owner_id=$1 and id=$2 and deleted_at is null", [ownerId, id]);
    if (!rows[0]) throw new ApiError(404, "not_found", "This source is unavailable in your workspace.");
    const document = rows[0].record; await this.get(ownerId, document.comparisonId); return document;
  }
  async findDuplicate(ownerId: string, comparisonId: string, hash: string) {
    await this.get(ownerId, comparisonId);
    const rows = await sqlQuery<{ record: DocumentRecord }>("select record from public.documents where owner_id=$1 and comparison_id=$2 and content_hash=$3 and deleted_at is null limit 1", [ownerId, comparisonId, hash]);
    return rows[0]?.record ?? null;
  }
  async run(ownerId: string, id: string) {
    const rows = await sqlQuery<{ record: RunRecord }>("select record from public.processing_runs where owner_id=$1 and id=$2", [ownerId, id]);
    if (!rows[0]) throw new ApiError(404, "not_found", "This processing run is unavailable.");
    const run = rows[0].record; await this.get(ownerId, run.comparisonId); return run;
  }
  async runs(ownerId: string, comparisonId: string) {
    await this.get(ownerId, comparisonId);
    const rows = await sqlQuery<{ record: RunRecord }>("select record from public.processing_runs where owner_id=$1 and comparison_id=$2 order by created_at", [ownerId, comparisonId]);
    return rows.map(row => row.record);
  }
  async pendingRuns() { return await rpc<RunRecord[]>("pending_runs") ?? []; }
  async saveRun(run: RunRecord, expectedFence?: string) { return rpc<boolean>("save_run", [run, expectedFence ?? null]); }
  async claimRun(id: string, fence: string, leaseUntil: string) { return rpc<RunRecord | null>("claim_run", [id, fence, leaseUntil]); }
  async renewLease(id: string, fence: string, leaseUntil: string) { return rpc<boolean>("renew_lease", [id, fence, leaseUntil]); }
  async retryRun(ownerId: string, id: string) { return rpc<RunRecord>("retry_run", [ownerId, id]); }
  async saveParsed(run: RunRecord, parsed: ParsedDocument) { await rpc("save_parsed", [run.id, run.fence, parsed]); }
  async getParsed(documentId: string) {
    const rows = await sqlQuery<{ record: ParsedDocument }>("select record from public.parsed_documents where document_id=$1", [documentId]);
    return rows[0]?.record ?? null;
  }
  async getCheckpoint(documentId: string, key: string) {
    const rows = await sqlQuery<{ result: unknown }>("select result from public.ai_checkpoints where document_id=$1 and key=$2", [documentId, key]);
    return rows[0]?.result ?? null;
  }
  async saveCheckpoint(run: RunRecord, key: string, value: unknown) { await rpc("save_checkpoint", [run.id, run.fence, key, value]); }
  async complete(run: RunRecord, quotation: Quotation) { return rpc<boolean>("complete_run", [run.id, run.fence, quotation]); }
  async writeObject(document: DocumentRecord, bytes: Uint8Array) { await storageWrite(document, bytes); }
  async readObject(document: DocumentRecord) { return storageRead(document); }
  async deleteObject(document: DocumentRecord) { await storageDelete(document); }
  async cleanup(options: { signal?: AbortSignal } = {}) {
    if (options.signal?.aborted) return;
    let entries: { id: string; storage_path: string }[];
    try { entries = await sqlQuery<{ id: string; storage_path: string }>("select id,storage_path from public.deletion_outbox order by created_at limit 50", [], options); }
    catch (error) { if (options.signal?.aborted) return; throw error; }
    for (const entry of entries) {
      if (options.signal?.aborted) return;
      try { await (options.signal ? storageDelete(entry.storage_path, options) : storageDelete(entry.storage_path)); }
      catch { continue; } // Retain the durable entry until canonical and staged objects are removed.
      if (options.signal?.aborted) return;
      // A signed staging ticket can be replayed for five minutes. Retain its tombstone
      // until every ticket has expired, then perform one final successful object delete.
      try { await sqlQuery("delete from public.deletion_outbox where id=$1 and created_at <= now()-interval '6 minutes'", [entry.id], options); }
      catch (error) { if (options.signal?.aborted) return; throw error; }
    }
  }
}
