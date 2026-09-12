import { ApiError } from "./errors";
import { sqlQuery } from "./neon-db";

/** Lazy initialization keeps the public fixture workspace independent of cloud services. */
export async function neonAuth() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret || secret.length < 32) throw new ApiError(503, "auth_unconfigured", "Private sign-in is not configured.");
  const { createNeonAuth } = await import("@neondatabase/auth/next/server");
  return createNeonAuth({ baseUrl, cookies: { secret, sessionDataTtl: 60, sameSite: "lax" }, logLevel: "silent" });
}

export function siteOrigin() {
  const site = process.env.FIELDOPS_SITE_URL;
  if (!site) throw new ApiError(503, "auth_unconfigured", "The hosted sign-in callback is not configured.");
  const url = new URL(site);
  if (url.protocol !== "https:" || url.username || url.password) throw new ApiError(503, "auth_unconfigured", "Hosted sign-in requires the configured HTTPS origin.");
  return url.origin;
}

export async function invitedSession(): Promise<{ id: string; name: string }> {
  const { data, error } = await (await neonAuth()).getSession();
  if (error || !data?.user || !data.session) throw new ApiError(401, "sign_in_required", "Sign in with an invited GitHub account.");
  // Signed SDK session cookies can be cached. Check revocation, expiry, provider identity
  // and the operator's invitation on EVERY private request; never trust editable metadata.
  const rows = await sqlQuery<{ id: string; name: string; invited: boolean }>(`
    select u.id, coalesce(nullif(u.name,''), 'Invited buyer') as name,
      exists(select 1 from neon_auth.account a join public.invited_accounts i
        on i.github_user_id=a."accountId" and i.active
        where a."userId"=u.id and a."providerId"='github') as invited
    from neon_auth.session s join neon_auth."user" u on u.id=s."userId"
    where s.id=$1 and s."userId"=$2 and s."expiresAt">now()
      and (not coalesce(u.banned,false) or u."banExpires"<=now())
  `, [data.session.id, data.user.id]);
  const user = rows[0];
  if (!user) throw new ApiError(401, "sign_in_required", "Your session ended. Sign in again.");
  if (!user.invited) throw new ApiError(403, "invite_required", "This GitHub account has not been invited to the private pilot. The sample workspace is available without sign-in.");
  return { id: user.id, name: user.name };
}
