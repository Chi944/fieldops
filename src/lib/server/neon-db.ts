import { neon } from "@neondatabase/serverless";
import { ApiError } from "./errors";

/** Server-only parameterized SQL. Never fall back to the integration's owner credential. */
export async function sqlQuery<T extends Record<string, unknown>>(text: string, params: unknown[] = [], options: { signal?: AbortSignal } = {}): Promise<T[]> {
  if (typeof window !== "undefined") throw new Error("Private database access is server-only.");
  const connection = process.env.FIELDOPS_DATABASE_URL;
  if (!connection) throw new ApiError(503, "storage_unavailable", "The private database runtime connection is not configured.");
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    signal.throwIfAborted();
    const sql = neon(connection, { fetchOptions: { signal, cache: "no-store" } });
    // SET LOCAL is scoped to this operation, including with pooled HTTP connections.
    const results = await sql.transaction([
      sql.query("set local role fieldops_server"),
      sql.query(text, params),
    ]);
    return results[1] as T[];
  } catch (error) {
    // Database errors may contain query fragments/document data. Expose fixed messages only.
    const message = error instanceof Error ? error.message.trim() : "";
    const raisedByFunction = (error as { code?: string } | null)?.code === "P0001";
    if (raisedByFunction && message === "stale_revision") throw new ApiError(409, "stale_revision", "The comparison changed. Reload it before saving.");
    if (raisedByFunction && message === "not_found") throw new ApiError(404, "not_found", "This resource is unavailable in your workspace.");
    if (raisedByFunction && message === "quota") throw new ApiError(429, "quota", "The free processing allowance is exhausted. Saved work remains available.");
    if (raisedByFunction && message === "comparison_document_limit") throw new ApiError(429, message, "This comparison already has five quotations. Delete a source or create another comparison.");
    if (raisedByFunction && message === "workspace_comparison_limit") throw new ApiError(429, message, "Your workspace has reached its 20-comparison pilot limit. Delete an unused comparison before creating another.");
    if (raisedByFunction && message === "workspace_document_limit") throw new ApiError(429, message, "Your workspace has reached its 50-original pilot limit. Delete unused sources and allow cleanup to finish before uploading again.");
    if (raisedByFunction && message === "workspace_storage_limit") throw new ApiError(429, message, "Your workspace has reached its 100 MiB original-file pilot limit. Delete unused sources and allow cleanup to finish, or upload smaller files.");
    if (raisedByFunction && message === "project_capacity") throw new ApiError(429, message, "The shared pilot capacity is full. Saved work remains available. Retry after unused sources have been deleted and cleanup has finished.");
    if (raisedByFunction && message === "upload_expired") throw new ApiError(410, message, "This unfinished upload expired after 24 hours. Delete its placeholder and upload the file again; saved quotations are unchanged.");
    if (raisedByFunction && message === "file_size") throw new ApiError(413, message, "Upload a nonempty file of at most 20 MiB, or split it into smaller files.");
    throw new ApiError(503, "storage_unavailable", "Private storage is unavailable. Retry when the service is restored.");
  }
}
