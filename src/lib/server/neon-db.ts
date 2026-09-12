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
    throw new ApiError(503, "storage_unavailable", "Private storage is unavailable. Retry when the service is restored.");
  }
}
