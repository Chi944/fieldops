import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/server/errors";
import { GET } from "@/app/api/workspace/status/route";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), sql: vi.fn(), capabilities: vi.fn() }));
vi.mock("@/lib/server/context", () => ({ authorize: mocks.authorize }));
vi.mock("@/lib/server/neon-db", () => ({ sqlQuery: mocks.sql }));
vi.mock("@/lib/server/config", () => ({ capabilities: mocks.capabilities }));

beforeEach(() => { vi.clearAllMocks(); mocks.capabilities.mockReturnValue({ canExtract: false, canUpload: true }); });
describe("private workspace diagnostics", () => {
  it("refuses unauthorized access before querying usage", async () => {
    mocks.authorize.mockRejectedValue(new ApiError(401, "sign_in_required", "Sign in."));
    const response = await GET(new Request("https://fieldops.example/api/workspace/status"));
    expect(response.status).toBe(401); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("uses the authorized owner and exposes no shared project counts", async () => {
    const workspace = { comparisons: 1, documents: 2, bytes: 200, pendingDeletionDocuments: 1, pendingDeletionBytes: 100, limits: { comparisons: 20, documents: 50, bytes: 104857600 } };
    const capacity = vi.fn().mockResolvedValue({ workspace, project: { comparisons: 99, documents: 200, bytes: 1100, limits: { comparisons: 100, documents: 200, bytes: 262144000 } }, uploadIntentTtlHours: 24 });
    mocks.authorize.mockResolvedValue({ ownerId: "invited-owner", repository: { mode: "cloud", capacity } });
    mocks.sql.mockResolvedValue([{ active: 1, waitingQuota: 2, failed: 3 }]);
    const response = await GET(new Request("https://fieldops.example/api/workspace/status?ownerId=other-user"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const value = await response.json();
    expect(capacity).toHaveBeenCalledWith("invited-owner");
    expect(mocks.sql.mock.calls[0][1]).toEqual(["invited-owner"]);
    expect(value).toMatchObject({ mode: "cloud", processing: "parse_only", capacity: workspace, sharedCapacityAvailable: false, jobs: { active: 1, waitingQuota: 2, failed: 3 } });
    expect(value).not.toHaveProperty("project"); expect(JSON.stringify(value)).not.toContain("invited-owner");
  });
  it("local diagnostics require no cloud connection and count only pending or failed runs", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "local-comparison" }]);
    const runs = vi.fn().mockResolvedValue(["parsing", "waiting_quota", "failed", "cancelled", "source_ready", "ready"].map(stage => ({ stage })));
    mocks.authorize.mockResolvedValue({ ownerId: "local-user", repository: { mode: "local", list, runs } });
    const response = await GET(new Request("http://127.0.0.1:3002/api/workspace/status"));
    expect(await response.json()).toMatchObject({ capacity: null, sharedCapacityAvailable: null, jobs: { active: 1, waitingQuota: 1, failed: 1 } });
    expect(runs).toHaveBeenCalledWith("local-user", "local-comparison"); expect(mocks.sql).not.toHaveBeenCalled();
  });
});
