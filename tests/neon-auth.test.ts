import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), sql: vi.fn(), create: vi.fn() }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: mocks.create }));
vi.mock("@/lib/server/neon-db", () => ({ sqlQuery: mocks.sql }));
import { invitedSession, neonAuth, siteOrigin } from "@/lib/server/neon-auth";
import { ApiError } from "@/lib/server/errors";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://synthetic.neon.tech/auth");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "synthetic-test-secret-over-32-characters");
  vi.stubEnv("FIELDOPS_SITE_URL", "https://fieldops.example/path");
  mocks.create.mockReturnValue({ getSession: mocks.getSession });
  mocks.getSession.mockResolvedValue({ data: { user: { id: "user-id", name: "Untrusted cached name" }, session: { id: "session-id" } }, error: null });
  mocks.sql.mockResolvedValue([{ id: "user-id", name: "Buyer", invited: true }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("Neon private admission", () => {
  it("rechecks persisted session and GitHub invitation on every request instead of trusting a cached user", async () => {
    expect(await invitedSession()).toEqual({ id: "user-id", name: "Buyer" });
    expect(await invitedSession()).toEqual({ id: "user-id", name: "Buyer" });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
    const [query, params] = mocks.sql.mock.calls[0];
    expect(params).toEqual(["session-id", "user-id"]);
    expect(query).toContain('s."expiresAt">now()');
    expect(query).toContain('a."providerId"=\'github\'');
    expect(query).toContain('i.github_user_id=a."accountId" and i.active');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ logLevel: "silent", cookies: expect.objectContaining({ sameSite: "lax" }) }));
  });
  it("rejects missing SDK sessions without querying private tables", async () => {
    mocks.getSession.mockResolvedValue({ data: null, error: null });
    await expect(invitedSession()).rejects.toMatchObject({ status: 401 });
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("denies revoked sessions and invitations even with a still-valid signed SDK cookie", async () => {
    mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "user-id", name: "Buyer", invited: false }]);
    await expect(invitedSession()).rejects.toMatchObject({ status: 401 });
    await expect(invitedSession()).rejects.toMatchObject({ status: 403, code: "invite_required" });
  });
  it("fails closed on database interruption and missing auth secrets", async () => {
    mocks.sql.mockRejectedValue(new ApiError(503, "storage_unavailable", "Private storage is unavailable."));
    await expect(invitedSession()).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "short");
    await expect(neonAuth()).rejects.toThrow("not configured");
  });
  it("pins callbacks to the configured HTTPS origin", () => {
    expect(siteOrigin()).toBe("https://fieldops.example");
    for (const site of ["http://fieldops.example", "https://user:password@fieldops.example"]) {
      vi.stubEnv("FIELDOPS_SITE_URL", site);
      expect(siteOrigin).toThrow("HTTPS origin");
    }
  });
});
