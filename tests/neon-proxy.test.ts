import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const sdk = vi.hoisted(() => ({ middleware: vi.fn(), handle: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/server/neon-auth", () => ({ neonAuth: sdk.auth }));
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ["FIELDOPS_LOCAL_MODE", "VERCEL", "RENDER", "AWS_LAMBDA_FUNCTION_NAME", "FIELDOPS_DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "FIELDOPS_SITE_URL"]) vi.stubEnv(key, "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Auth boundary tests must never call a provider"); }));
  sdk.auth.mockResolvedValue({ middleware: sdk.middleware });
  sdk.middleware.mockReturnValue(sdk.handle);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function cloud() {
  vi.stubEnv("FIELDOPS_DATABASE_URL", "postgresql://test.invalid/fixture");
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "synthetic-cookie-secret-at-least-32-characters");
  vi.stubEnv("FIELDOPS_SITE_URL", "https://fieldops.example.test");
}

describe("managed OAuth proxy boundary", () => {
  it("preserves the SDK verifier redirect and every session/challenge cookie", async () => {
    cloud();
    const request = new NextRequest("https://fieldops.example.test/auth/callback?neon_auth_session_verifier=synthetic-one-time-verifier", { headers: { cookie: "__Secure-neon-auth.session_challenge=synthetic-challenge" } });
    const exchange = NextResponse.redirect("https://fieldops.example.test/auth/callback");
    exchange.headers.append("Set-Cookie", "__Secure-neon-auth.session_token=synthetic-session; Path=/; HttpOnly; Secure; SameSite=Lax");
    exchange.headers.append("Set-Cookie", "__Secure-neon-auth.local.session_data=synthetic-signed-cache; Path=/; HttpOnly; Secure; SameSite=Lax");
    exchange.headers.append("Set-Cookie", "__Secure-neon-auth.session_challenge=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    sdk.handle.mockResolvedValue(exchange);
    const response = await proxy(request);
    expect(sdk.auth).toHaveBeenCalledOnce();
    expect(sdk.middleware).toHaveBeenCalledWith({ loginUrl: "/auth/login" });
    expect(sdk.handle).toHaveBeenCalledWith(request);
    expect(response).toBe(exchange);
    expect(response.headers.get("location")).toBe("https://fieldops.example.test/auth/callback");
    expect(response.headers.getSetCookie()).toEqual(exchange.headers.getSetCookie());
    expect(response.headers.getSetCookie()).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps public fixtures, status, login and API authorization out of global auth redirects", async () => {
    cloud();
    for (const path of ["/", "/comparisons/demo-studio/compare", "/reliability", "/api/status", "/auth/login", "/api/comparisons"]) {
      const response = await proxy(new NextRequest(`https://fieldops.example.test${path}`));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.has("location")).toBe(false);
    }
    expect(sdk.auth).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "");
    const demoCallback = await proxy(new NextRequest("https://fieldops.example.test/auth/callback?neon_auth_session_verifier=synthetic"));
    expect(demoCallback.headers.get("x-middleware-next")).toBe("1");
    expect(sdk.auth).not.toHaveBeenCalled();
  });

  it("applies the local loopback guard before OAuth even when cloud variables exist", async () => {
    cloud(); vi.stubEnv("FIELDOPS_LOCAL_MODE", "true");
    const local = await proxy(new NextRequest("http://localhost:3001/auth/callback?neon_auth_session_verifier=synthetic", { headers: { host: "localhost:3001" } }));
    expect(local.headers.get("x-middleware-next")).toBe("1");
    const remote = await proxy(new NextRequest("https://fieldops.example.test/auth/callback?neon_auth_session_verifier=synthetic"));
    expect(remote.status).toBe(403);
    expect(await remote.json()).toMatchObject({ error: { code: "local_only" } });
    const forwarded = await proxy(new NextRequest("http://localhost:3001/auth/callback", { headers: { host: "localhost:3001", "x-forwarded-host": "attacker.example.test" } }));
    expect(forwarded.status).toBe(403);
    expect(sdk.auth).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
