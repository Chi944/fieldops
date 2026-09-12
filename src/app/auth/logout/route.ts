import { authClient } from "@/lib/server/supabase";
import { checkRequestBoundary } from "@/lib/server/config";
import { json, route } from "@/lib/server/errors";
export const POST = route(async (request: Request) => { checkRequestBoundary(request, false); await (await authClient()).auth.signOut(); return json({ signedOut: true }); });
