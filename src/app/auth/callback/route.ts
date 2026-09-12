import { authClient } from "@/lib/server/supabase";
import { authorize } from "@/lib/server/context";
import { ApiError, route } from "@/lib/server/errors";
export const GET = route(async (request: Request) => {
  const site = process.env.FIELDOPS_SITE_URL;
  if (!site) throw new ApiError(503, "auth_unconfigured", "Sign-in callback is not configured.");
  const code = new URL(request.url).searchParams.get("code"); const client = await authClient();
  if (!code) return Response.redirect(`${new URL(site).origin}/?auth=failed`);
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return Response.redirect(`${new URL(site).origin}/?auth=failed`);
  try { await authorize(request); } catch { await client.auth.signOut(); return Response.redirect(`${new URL(site).origin}/?auth=invite_required`); }
  return Response.redirect(`${new URL(site).origin}/`);
});
