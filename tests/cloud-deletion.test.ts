import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRepository } from "@/lib/server/cloud-repository";
import { ApiError } from "@/lib/server/errors";

const transport = vi.hoisted(() => ({ sql: vi.fn(), storageDelete: vi.fn() }));
vi.mock("@/lib/server/neon-db", () => ({ sqlQuery: transport.sql }));
vi.mock("@/lib/server/neon-storage", () => ({ storageDelete: transport.storageDelete, storageRead: vi.fn(), storageWrite: vi.fn() }));

const owner = "10000000-0000-0000-0000-000000000001";
const resource = "20000000-0000-0000-0000-000000000002";
const tombstone = { id: "30000000-0000-0000-0000-000000000003", storage_path: `${owner}/${resource}` };

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("foreground deletion with injected private transports", () => {
  it("commits deletion before a bounded sweep, awaits its cancellation and retains the cleanup tombstone", async () => {
    const events: string[] = [];
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    transport.sql.mockImplementation(async (query: string) => {
      if (query.startsWith("select public.fieldops_delete_comparison")) { events.push("committed"); return [{ result: null }]; }
      if (query.startsWith("select id,storage_path")) { events.push("outbox-read"); return [tombstone]; }
      throw new Error("No tombstone deletion is allowed after aborted storage cleanup");
    });
    transport.storageDelete.mockImplementation(async (_path: string, options: { signal: AbortSignal }) => {
      events.push("storage-started");
      await new Promise<void>((_resolve, reject) => options.signal.addEventListener("abort", () => {
        events.push("storage-stopped"); reject(new Error("Synthetic storage timeout"));
      }, { once: true }));
    });
    let acknowledged = false;
    const operation = new CloudRepository().remove(owner, resource).then(() => { acknowledged = true; });
    try {
      await vi.waitFor(() => expect(events).toEqual(["committed", "outbox-read", "storage-started"]));
      expect(timeout).toHaveBeenCalledWith(3000);
      expect(acknowledged).toBe(false);
      expect(transport.storageDelete).toHaveBeenCalledWith(tombstone.storage_path, { signal: deadline.signal });
    } finally { deadline.abort(); await operation; }
    expect(acknowledged).toBe(true);
    expect(events.at(-1)).toBe("storage-stopped");
    expect(transport.sql).toHaveBeenCalledTimes(2);
    expect(transport.sql.mock.calls[0][1]).toEqual([owner, resource]);
  });

  it("acknowledges committed source deletion when object cleanup fails, preserving its outbox entry", async () => {
    transport.sql.mockResolvedValueOnce([{ result: null }]).mockResolvedValueOnce([tombstone]);
    transport.storageDelete.mockRejectedValue(new Error("Synthetic private provider failure"));
    await expect(new CloudRepository().removeDocument(owner, resource, 7)).resolves.toBeUndefined();
    expect(transport.sql.mock.calls[0][0]).toContain("fieldops_delete_document");
    expect(transport.sql.mock.calls[0][1]).toEqual([owner, resource, 7]);
    expect(transport.sql).toHaveBeenCalledTimes(2);
    expect(transport.storageDelete).toHaveBeenCalledTimes(1);
  });

  it("does not turn a post-commit outbox-read failure into a failed deletion response", async () => {
    transport.sql.mockResolvedValueOnce([{ result: null }]).mockRejectedValueOnce(new Error("Synthetic database maintenance outage"));
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(new CloudRepository().remove(owner, resource)).resolves.toBeUndefined();
    expect(transport.storageDelete).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('{"event":"deletion_cleanup_pending"}');
  });

  it("still rejects a failed deletion transaction and does not start any cleanup", async () => {
    transport.sql.mockRejectedValue(new ApiError(409, "stale_revision", "Reload before deleting this source."));
    await expect(new CloudRepository().removeDocument(owner, resource, 7)).rejects.toMatchObject({ code: "stale_revision" });
    expect(transport.sql).toHaveBeenCalledTimes(1);
    expect(transport.storageDelete).not.toHaveBeenCalled();
  });
});
