import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ query: vi.fn((text: string, params?: unknown[]) => ({ text, params })), transaction: vi.fn(), connect: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: transport.connect }));
import { sqlQuery } from "@/lib/server/neon-db";

beforeEach(() => {
  vi.stubEnv("FIELDOPS_DATABASE_URL", "postgresql://synthetic-runtime-only.invalid/db");
  transport.connect.mockReturnValue({ query: transport.query, transaction: transport.transaction });
  transport.transaction.mockResolvedValue([[], [{ result: "synthetic" }]]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Neon HTTP query boundary with injected transport", () => {
  it("restricts each operation in its own transaction and keeps values parameterized", async () => {
    const value = "literal supplier '; select password; --";
    expect(await sqlQuery("select $1 as result", [value])).toEqual([{ result: "synthetic" }]);
    expect(transport.transaction).toHaveBeenCalledWith([{ text: "set local role fieldops_server", params: undefined }, { text: "select $1 as result", params: [value] }]);
    expect(transport.connect).toHaveBeenCalledWith("postgresql://synthetic-runtime-only.invalid/db", expect.objectContaining({ fetchOptions: expect.objectContaining({ cache: "no-store" }) }));
  });
  it("refuses an absent runtime credential even when the admin variable exists", async () => {
    vi.stubEnv("FIELDOPS_DATABASE_URL", ""); vi.stubEnv("DATABASE_URL", "ADMIN-PLACEHOLDER-NOT-A-CREDENTIAL");
    await expect(sqlQuery("select 1")).rejects.toMatchObject({ status: 503, code: "storage_unavailable" });
    expect(transport.connect).not.toHaveBeenCalled();
  });
  it("keeps safe stale-revision recovery while redacting query fragments", async () => {
    transport.transaction.mockRejectedValueOnce(Object.assign(new Error("stale_revision"), { code: "P0001", detail: "synthetic private quotation payload" }));
    await expect(sqlQuery("select $1", ["synthetic payload"])).rejects.toMatchObject({ status: 409, code: "stale_revision", message: "The comparison changed. Reload it before saving." });
  });
  it("never returns raw database error details or connection values", async () => {
    transport.transaction.mockRejectedValueOnce(new Error("connection failed: synthetic private URL and quotation text"));
    await expect(sqlQuery("select 1")).rejects.toMatchObject({ status: 503, code: "storage_unavailable", message: "Private storage is unavailable. Retry when the service is restored." });
  });
  it.each([
    ["comparison_document_limit", 429, "five quotations"],
    ["workspace_comparison_limit", 429, "20-comparison"],
    ["workspace_document_limit", 429, "50-original"],
    ["workspace_storage_limit", 429, "100 MiB"],
    ["project_capacity", 429, "shared pilot capacity"],
    ["upload_expired", 410, "24 hours"],
    ["file_size", 413, "20 MiB"],
  ])("returns actionable, fixed %s recovery without private database details", async (code, status, recovery) => {
    transport.transaction.mockRejectedValueOnce(Object.assign(new Error(code), { code: "P0001", detail: "private source filename and contents" }));
    await expect(sqlQuery("select synthetic_private_value")).rejects.toMatchObject({ status, code, message: expect.stringContaining(recovery) });
  });
  it("propagates a caller's maintenance cancellation to the actual HTTP signal", async () => {
    const controller = new AbortController();
    await sqlQuery("select 1", [], { signal: controller.signal });
    const options = transport.connect.mock.calls[0][1] as { fetchOptions: { signal: AbortSignal } };
    expect(options.fetchOptions.signal.aborted).toBe(false);
    controller.abort();
    expect(options.fetchOptions.signal.aborted).toBe(true);
  });
  it("does not start a database request after its maintenance deadline expired", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(sqlQuery("select 1", [], { signal: controller.signal })).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(transport.connect).not.toHaveBeenCalled();
  });
});
