import { NextResponse, type NextRequest } from "next/server";
import { configuration, checkRequestBoundary } from "@/lib/server/config";
import { ApiError } from "@/lib/server/errors";
import { neonAuth } from "@/lib/server/neon-auth";

/** Complete the managed OAuth handoff; private handlers still verify session and invitation. */
export async function proxy(request: NextRequest) {
  const config = configuration();
  if (config.local) {
    try { checkRequestBoundary(request, true); } catch (error) { return NextResponse.json({ error: { code: error instanceof ApiError ? error.code : "local_only", message: error instanceof ApiError ? error.message : "Local mode is loopback-only." } }, { status: 403 }); }
    return NextResponse.next();
  }
  // Managed OAuth can return its verifier to the application origin root. Only
  // that handoff and the dedicated callback invoke auth; ordinary demo visits do not.
  // The SDK validates the challenge and preserves its redirect and Set-Cookie.
  const rootHandoff = request.method === "GET" && request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("neon_auth_session_verifier");
  if (config.cloud && (request.nextUrl.pathname === "/auth/callback" || rootHandoff)) return (await neonAuth()).middleware({ loginUrl: "/auth/login" })(request);
  return NextResponse.next();
}
export const config = { matcher: ["/", "/api/:path*", "/auth/:path*"] };
