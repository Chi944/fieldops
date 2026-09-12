import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./errors";

/** Worker-safe client; no request cookies or Next.js runtime imports. */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, "storage_unconfigured", "Private cloud storage is not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
