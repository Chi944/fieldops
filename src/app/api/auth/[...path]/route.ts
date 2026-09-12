import type { NextRequest } from "next/server";
import { neonAuth } from "@/lib/server/neon-auth";
import { checkRequestBoundary } from "@/lib/server/config";
import { route } from "@/lib/server/errors";

// Initialize per request so public demo builds never depend on auth credentials.
type Context = { params: Promise<{ path: string[] }> };
export const GET = route(async (request: NextRequest, context: Context) => (await neonAuth()).handler().GET(request, context));
export const POST = route(async (request: NextRequest, context: Context) => {
  checkRequestBoundary(request, false);
  return (await neonAuth()).handler().POST(request, context);
});
