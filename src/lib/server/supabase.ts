import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ApiError } from "./errors";

export { adminClient } from "./supabase-admin";
export async function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError(503, "auth_unconfigured", "Sign-in is not configured for this deployment.");
  const store = await cookies();
  return createServerClient(url, key, { cookies: { getAll: () => store.getAll(), setAll: (values) => { for (const { name, value, options } of values) store.set(name, value, options); } } });
}
