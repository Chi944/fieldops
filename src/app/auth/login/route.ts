import { authClient } from "@/lib/server/supabase";
import { ApiError, route } from "@/lib/server/errors";
export const GET = route(async () => {
  const url = process.env.FIELDOPS_SITE_URL;
  if (!url) throw new ApiError(503, "auth_unconfigured", "The hosted sign-in callback is not configured.");
  const client = await authClient();
  const { data, error } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${new URL(url).origin}/auth/callback`, scopes: "read:user user:email" } });
  if (error || !data.url) throw new ApiError(503, "sign_in_failed", "GitHub sign-in could not be started. Try again later.");
  return Response.redirect(data.url);
});
