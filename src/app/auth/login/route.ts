import { siteOrigin } from "@/lib/server/neon-auth";
import { ApiError, route } from "@/lib/server/errors";
import { authRedirect, postAuth, withAuthCookies } from "../transport";

export const GET = route(async (request: Request) => {
  const response = await postAuth(request, "sign-in/social", { provider: "github", callbackURL: `${siteOrigin()}/auth/callback` });
  const data: unknown = await response.json().catch(() => null);
  const value = data && typeof data === "object" && "url" in data ? data.url : undefined;
  let target: URL | undefined;
  try { if (typeof value === "string") target = new URL(value); } catch { /* Invalid upstream redirects fail closed. */ }
  if (!response.ok || !target || target.protocol !== "https:" || target.username || target.password) {
    throw new ApiError(503, "sign_in_failed", "GitHub sign-in could not be started. Try again later.");
  }
  return withAuthCookies(authRedirect(target.href), response);
});
