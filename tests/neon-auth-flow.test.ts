import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTH_SKIP_ROUTES, handleAuthProxyRequest, parseSetCookies, processAuthMiddleware, resolveNeonAuthLogging, validateSessionData } from "@neondatabase/auth/server";
import { ApiError } from "@/lib/server/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), authorize: vi.fn() }));
const site = "https://fieldops.example.test";
const baseUrl = "https://synthetic-auth.example.test/auth";
const secret = "synthetic-cookie-secret-at-least-32-characters";
const log = resolveNeonAuthLogging({ logLevel: "silent" });
vi.mock("@/lib/server/neon-auth", () => ({ neonAuth: mocks.auth, siteOrigin: () => "https://fieldops.example.test" }));
vi.mock("@/lib/server/context", () => ({ authorize: mocks.authorize }));
import { GET as login } from "@/app/auth/login/route";
import { POST as logout } from "@/app/auth/logout/route";
import { GET as callback } from "@/app/auth/callback/route";

beforeEach(() => {
  vi.resetAllMocks();
  // Exercise the installed SDK proxy core. Only its small Next route adapter and
  // the network are replaced; no OAuth provider or user account is contacted.
  mocks.auth.mockResolvedValue({ handler: () => ({ POST: async (request: Request, context: { params: Promise<{ path: string[] }> }) => handleAuthProxyRequest({
    request, path: (await context.params).path.join("/"), baseUrl, cookieSecret: secret, sessionDataTtl: 60, sameSite: "lax", log,
  }) }) });
  mocks.authorize.mockResolvedValue({ userId: "synthetic-invited-buyer" });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No unexpected provider calls are allowed"); }));
});
afterEach(() => vi.unstubAllGlobals());

function provider(body: unknown, cookies: string[] = [], status = 200) {
  const response = Response.json(body, { status });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}
function tokenDeletion() {
  return provider({ success: true }, ["__Secure-neon-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure"]);
}
function cookieNames(response: Response) {
  return response.headers.getSetCookie().flatMap(parseSetCookies).map((cookie) => cookie.name);
}

describe("Neon auth routes with the installed SDK proxy core", () => {
  it("starts a direct or external-referrer login with the fixed origin/callback and retains challenge cookies", async () => {
    for (const headers of [undefined, { referer: "https://untrusted.example.test/page", origin: "https://untrusted.example.test" }]) {
      vi.mocked(fetch).mockResolvedValueOnce(provider({ url: "https://github.com/login/oauth/authorize?state=synthetic" }, [
        "__Secure-neon-auth.session_challenge=synthetic-challenge; Path=/; HttpOnly; Secure; SameSite=None",
        "__Secure-neon-auth.state=synthetic-state; Path=/; HttpOnly; Secure",
      ]));
      const response = await login(new Request(`${site}/auth/login?callbackURL=https://untrusted.example.test&returnTo=https://untrusted.example.test`, {
        headers: { ...headers, cookie: "__Secure-neon-auth.session_token=synthetic-old-session; unrelated_private_cookie=must-not-forward" },
      }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=synthetic");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const [url, options] = vi.mocked(fetch).mock.calls.at(-1)!;
      expect(url).toBe(`${baseUrl}/sign-in/social`);
      expect(options?.method).toBe("POST");
      expect(new Headers(options?.headers).get("origin")).toBe(site);
      expect(new Headers(options?.headers).get("cookie")).toBe("__Secure-neon-auth.session_token=synthetic-old-session");
      expect(JSON.parse(options?.body as string)).toEqual({ provider: "github", callbackURL: `${site}/auth/callback` });
      expect(cookieNames(response)).toEqual(["__Secure-neon-auth.session_challenge", "__Secure-neon-auth.state"]);
      for (const cookie of response.headers.getSetCookie()) expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects provider errors and malformed or unsafe sign-in redirects", async () => {
    for (const response of [
      provider({ message: "Unavailable" }, [], 502),
      provider({ url: "javascript:alert(1)" }),
      provider({ url: "http://github.com/login" }),
      provider({ url: "https://user:password@github.com/login" }),
      new Response("not JSON", { status: 200 }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(response);
      const result = await login(new Request(`${site}/auth/login`));
      expect(result.status).toBe(503);
      expect(await result.json()).toMatchObject({ error: { code: "sign_in_failed" } });
      expect(result.headers.has("location")).toBe(false);
    }
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await login(new Request(`${site}/auth/login`))).status).toBe(503);
  });

  it("clears token and signed cache on successful logout, and never claims success on provider failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(tokenDeletion());
    const request = () => new Request(`${site}/auth/logout`, { method: "POST", headers: { Origin: site, Cookie: "__Secure-neon-auth.session_token=synthetic-session" } });
    const success = await logout(request());
    expect(await success.json()).toEqual({ signedOut: true });
    expect(cookieNames(success)).toEqual(["__Secure-neon-auth.session_token", "__Secure-neon-auth.local.session_data"]);
    for (const cookie of success.headers.getSetCookie()) expect(cookie).toContain("Max-Age=0");
    vi.mocked(fetch).mockResolvedValueOnce(provider({ error: "Service unavailable" }, [], 503));
    const failed = await logout(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "sign_out_failed" } });
    expect(failed.headers.has("set-cookie")).toBe(false);
    const blocked = await logout(new Request(`${site}/auth/logout`, { method: "POST", headers: { Origin: "https://untrusted.example.test" } }));
    expect(blocked.status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps callback admission denied when cleanup fails and preserves cleanup cookies when it succeeds", async () => {
    mocks.authorize.mockRejectedValue(new ApiError(403, "invite_required", "Not invited"));
    const request = () => new Request(`${site}/auth/callback?returnTo=https://untrusted.example.test`, { headers: { referer: "https://github.com/", cookie: "__Secure-neon-auth.session_token=synthetic-session" } });
    vi.mocked(fetch).mockResolvedValueOnce(provider({ error: "Service unavailable" }, [], 503));
    const failed = await callback(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { code: "sign_out_failed" } });
    expect(failed.headers.has("location")).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(tokenDeletion());
    const denied = await callback(request());
    expect(denied.status).toBe(303);
    expect(denied.headers.get("location")).toBe(`${site}/?auth=invite_required`);
    expect(cookieNames(denied)).toContain("__Secure-neon-auth.local.session_data");
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get("origin")).toBe(site);
  });

  it("admits only the authorized callback and does not disguise a database outage as failed sign-in", async () => {
    const admitted = await callback(new Request(`${site}/auth/callback?returnTo=https://untrusted.example.test`));
    expect(admitted.status).toBe(303);
    expect(admitted.headers.get("location")).toBe(`${site}/`);
    mocks.authorize.mockRejectedValue(new ApiError(503, "storage_unavailable", "Private storage is unavailable"));
    const unavailable = await callback(new Request(`${site}/auth/callback`));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: { code: "storage_unavailable" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("installed Neon SDK managed callback contract", () => {
  it("exchanges the verifier with the challenge, removes it from the redirect and signs the returned session cache", async () => {
    const now = new Date().toISOString();
    const session = { user: { id: "synthetic-user", createdAt: now, updatedAt: now }, session: { id: "synthetic-session", userId: "synthetic-user", createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
    vi.mocked(fetch).mockResolvedValueOnce(provider(session, [
      "__Secure-neon-auth.session_token=synthetic-issued-session; Path=/; HttpOnly; Secure",
      "__Secure-neon-auth.session_challenge=; Path=/; Max-Age=0; HttpOnly; Secure",
    ])).mockResolvedValueOnce(provider(session));
    const result = await processAuthMiddleware({
      request: new Request(`${site}/auth/callback?neon_auth_session_verifier=synthetic-one-time-verifier`, { headers: { Cookie: "__Secure-neon-auth.session_challenge=synthetic-challenge; unrelated_private_cookie=must-not-forward" } }),
      pathname: "/auth/callback", skipRoutes: DEFAULT_AUTH_SKIP_ROUTES, loginUrl: "/auth/login", baseUrl, cookieSecret: secret, sessionDataTtl: 60, sameSite: "lax", log,
    });
    expect(result.action).toBe("redirect_oauth");
    if (result.action !== "redirect_oauth") throw new Error("Expected managed callback exchange");
    expect(result.redirectUrl.href).toBe(`${site}/auth/callback`);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${baseUrl}/get-session?neon_auth_session_verifier=synthetic-one-time-verifier`);
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("cookie")).toBe("__Secure-neon-auth.session_challenge=synthetic-challenge");
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get("cookie")).toBe("__Secure-neon-auth.session_token=synthetic-issued-session");
    const cookies = result.cookies.flatMap(parseSetCookies);
    expect(cookies.find((cookie) => cookie.name === "__Secure-neon-auth.session_challenge")?.maxAge).toBe(0);
    const cache = cookies.find((cookie) => cookie.name === "__Secure-neon-auth.local.session_data");
    expect(cache).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    expect(cache?.maxAge).toBeLessThanOrEqual(60);
    const verified = await validateSessionData(cache!.value, secret);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.session?.id).toBe("synthetic-session");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
