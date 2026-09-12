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
  // Neon exchanges the one-time verifier and challenge cookie here, before
  // the callback handler can read a session. Keep the SDK redirect and Set-Cookie.
  if (config.cloud && request.nextUrl.pathname === "/auth/callback") return (await neonAuth()).middleware({ loginUrl: "/auth/login" })(request);
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*", "/auth/:path*"] };
