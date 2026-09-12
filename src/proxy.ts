import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { configuration, checkRequestBoundary } from "@/lib/server/config";
import { ApiError } from "@/lib/server/errors";

/** Refresh OAuth cookies only. Every API handler still checks identity, invitation and ownership. */
export async function proxy(request: NextRequest) {
  const config = configuration();
  if (config.local) {
    try { checkRequestBoundary(request, true); } catch (error) { return NextResponse.json({ error: { code: error instanceof ApiError ? error.code : "local_only", message: error instanceof ApiError ? error.message : "Local mode is loopback-only." } }, { status: 403 }); }
    return NextResponse.next();
  }
  if (!config.supabase) return NextResponse.next();
  let response = NextResponse.next({ request });
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (values) => { for (const { name, value } of values) request.cookies.set(name, value); response = NextResponse.next({ request }); for (const { name, value, options } of values) response.cookies.set(name, value, options); },
  } });
  await client.auth.getClaims(); return response;
}
export const config = { matcher: ["/api/:path*", "/auth/:path*"] };
