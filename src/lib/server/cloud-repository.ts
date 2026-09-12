import type { Comparison, ParsedDocument, Quotation } from "@/lib/domain/types";
import type { Repository, DocumentRecord, RunRecord } from "./contracts";
import { adminClient } from "./supabase-admin";
import { ApiError } from "./errors";

type DbError = { code?: string; message: string } | null;
function checked<T>({ data, error }: { data: T; error: DbError }): T {
  if (error) {
    if (error.message.includes("stale_revision")) throw new ApiError(409, "stale_revision", "The comparison changed. Reload it before saving.");
    if (error.message.includes("not_found")) throw new ApiError(404, "not_found", "This resource is unavailable in your workspace.");
    if (error.message.includes("quota")) throw new ApiError(429, "quota", "The free processing allowance is exhausted. Saved work remains available.");
    throw new ApiError(503, "storage_unavailable", "Private storage is unavailable. Retry when the service is restored.");
  }
  return data;
}
export class CloudRepository implements Repository {
  readonly mode = "cloud" as const;
  private client() { return adminClient(); }
  async list(ownerId: string) {
    const data = checked(await this.client().from("comparisons").select("snapshot").eq("owner_id", ownerId).is("deleted_at", null).order("updated_at", { ascending: false }));
    return (data ?? []).map((r) => r.snapshot as Comparison);
  }
  async get(ownerId: string, id: string) {
    const data = checked(await this.client().from("comparisons").select("snapshot").eq("owner_id", ownerId).eq("id", id).is("deleted_at", null).maybeSingle());
    if (!data) throw new ApiError(404, "not_found", "This comparison is unavailable in your workspace."); return data.snapshot as Comparison;
  }
  async create(ownerId: string, comparison: Comparison) {
    checked(await this.client().rpc("fieldops_create_comparison", { p_owner: ownerId, p_snapshot: comparison }));
  }
  async save(ownerId: string, comparison: Comparison, expectedRevision: number) {
    checked(await this.client().rpc("fieldops_save_comparison", { p_owner: ownerId, p_snapshot: comparison, p_expected_revision: expectedRevision }));
  }
  async remove(ownerId: string, comparisonId: string) {
    checked(await this.client().rpc("fieldops_delete_comparison", { p_owner: ownerId, p_comparison: comparisonId })); await this.cleanup();
  }
  async removeDocument(ownerId: string, documentId: string, expectedRevision: number) {
    checked(await this.client().rpc("fieldops_delete_document", { p_owner: ownerId, p_document: documentId, p_expected_revision: expectedRevision })); await this.cleanup();
  }
  async createUpload(ownerId: string, document: DocumentRecord, run: RunRecord | null, quotation: Quotation, expectedRevision: number) {
    checked(await this.client().rpc("fieldops_create_upload", { p_owner: ownerId, p_document: document, p_run: run, p_quotation: quotation, p_expected_revision: expectedRevision }));
  }
  async finalizeUpload(ownerId: string, documentId: string, hash: string, run: RunRecord) {
    checked(await this.client().rpc("fieldops_finalize_upload", { p_owner: ownerId, p_document: documentId, p_hash: hash, p_run: run }));
  }
  async document(ownerId: string, id: string) {
    const data = checked(await this.client().from("documents").select("record").eq("owner_id", ownerId).eq("id", id).is("deleted_at", null).maybeSingle());
    if (!data) throw new ApiError(404, "not_found", "This source is unavailable in your workspace.");
    const document = data.record as DocumentRecord; await this.get(ownerId, document.comparisonId); return document;
  }
  async findDuplicate(ownerId: string, comparisonId: string, hash: string) {
    await this.get(ownerId, comparisonId);
    const data = checked(await this.client().from("documents").select("record").eq("owner_id", ownerId).eq("comparison_id", comparisonId).eq("content_hash", hash).is("deleted_at", null).limit(1));
    return data?.[0]?.record as DocumentRecord ?? null;
  }
  async run(ownerId: string, id: string) {
    const data = checked(await this.client().from("processing_runs").select("record").eq("owner_id", ownerId).eq("id", id).maybeSingle());
    if (!data) throw new ApiError(404, "not_found", "This processing run is unavailable."); const run = data.record as RunRecord; await this.get(ownerId, run.comparisonId); return run;
  }
  async runs(ownerId: string, comparisonId: string) {
    await this.get(ownerId, comparisonId);
    const data = checked(await this.client().from("processing_runs").select("record").eq("owner_id", ownerId).eq("comparison_id", comparisonId));
    return (data ?? []).map((r) => r.record as RunRecord);
  }
  async pendingRuns() {
    const data = checked(await this.client().rpc("fieldops_pending_runs")); return (data ?? []) as RunRecord[];
  }
  async saveRun(run: RunRecord, expectedFence?: string) {
    return checked(await this.client().rpc("fieldops_save_run", { p_record: run, p_expected_fence: expectedFence ?? null })) as boolean;
  }
  async claimRun(id: string, fence: string, leaseUntil: string) {
    return checked(await this.client().rpc("fieldops_claim_run", { p_run: id, p_fence: fence, p_lease_until: leaseUntil })) as RunRecord | null;
  }
  async renewLease(id: string, fence: string, leaseUntil: string) {
    return checked(await this.client().rpc("fieldops_renew_lease", { p_run: id, p_fence: fence, p_lease_until: leaseUntil })) as boolean;
  }
  async retryRun(ownerId: string, id: string) {
    return checked(await this.client().rpc("fieldops_retry_run", { p_owner: ownerId, p_run: id })) as RunRecord;
  }
  async saveParsed(run: RunRecord, parsed: ParsedDocument) {
    checked(await this.client().rpc("fieldops_save_parsed", { p_run: run.id, p_fence: run.fence, p_parsed: parsed }));
  }
  async getParsed(documentId: string) {
    const data = checked(await this.client().from("parsed_documents").select("record").eq("document_id", documentId).maybeSingle()); return data?.record as ParsedDocument ?? null;
  }
  async getCheckpoint(documentId: string, key: string) {
    const data = checked(await this.client().from("ai_checkpoints").select("result").eq("document_id", documentId).eq("key", key).maybeSingle()); return data?.result ?? null;
  }
  async saveCheckpoint(run: RunRecord, key: string, value: unknown) {
    checked(await this.client().rpc("fieldops_save_checkpoint", { p_run: run.id, p_fence: run.fence, p_key: key, p_result: value }));
  }
  async complete(run: RunRecord, quotation: Quotation) {
    return checked(await this.client().rpc("fieldops_complete_run", { p_run: run.id, p_fence: run.fence, p_quotation: quotation })) as boolean;
  }
  async writeObject(document: DocumentRecord, bytes: Uint8Array) {
    checked(await this.client().storage.from("quotations").upload(document.storagePath, bytes, { contentType: document.contentType, upsert: false }));
  }
  async readObject(document: DocumentRecord) {
    const data = checked(await this.client().storage.from("quotations").download(document.storagePath));
    if (!data) throw new ApiError(404, "source_unavailable", "The original source could not be loaded."); return new Uint8Array(await data.arrayBuffer());
  }
  async deleteObject(document: DocumentRecord) { checked(await this.client().storage.from("quotations").remove([document.storagePath])); }
  async cleanup() {
    const entries = checked(await this.client().from("deletion_outbox").select("id,storage_path").limit(50));
    for (const entry of entries ?? []) {
      const { error } = await this.client().storage.from("quotations").remove([entry.storage_path]);
      if (!error) checked(await this.client().from("deletion_outbox").delete().eq("id", entry.id));
    }
  }
}
