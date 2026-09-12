import { siteOrigin } from "@/lib/server/neon-auth";
import { authorize } from "@/lib/server/context";
import { ApiError, route } from "@/lib/server/errors";
import { authRedirect, postAuth, withAuthCookies } from "../transport";

export const GET = route(async (request: Request) => {
  const site = siteOrigin();
  try { await authorize(request); } catch (error) {
    if (error instanceof ApiError && error.status >= 500) throw error;
    const response = await postAuth(request, "sign-out");
    if (!response.ok) throw new ApiError(503, "sign_out_failed", "Private access was denied, but sign-out could not be confirmed. Try signing out again.");
    return withAuthCookies(authRedirect(`${site}/?auth=${error instanceof ApiError && error.code === "invite_required" ? "invite_required" : "failed"}`), response);
  }
  return authRedirect(`${site}/`);
});
