import { NextRequest } from "next/server";
import { neonAuth, siteOrigin } from "@/lib/server/neon-auth";

/** Pin server-initiated auth POSTs to our origin even for bookmark/OAuth GETs without a referrer. */
export async function postAuth(request: Request, path: "sign-in/social" | "sign-out", body: Record<string, string> = {}) {
  const site = siteOrigin();
  const upstream = new NextRequest(`${site}/api/auth/${path}`, {
    method: "POST",
    headers: { Origin: site, "Content-Type": "application/json", Cookie: request.headers.get("cookie") ?? "" },
    body: JSON.stringify(body),
  });
  return (await neonAuth()).handler().POST(upstream, { params: Promise.resolve({ path: path.split("/") }) });
}

/** The SDK owns cookie filtering, security attributes, and session-cache invalidation. */
export function withAuthCookies(response: Response, authResponse: Response) {
  for (const cookie of authResponse.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
  return response;
}

export function authRedirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
