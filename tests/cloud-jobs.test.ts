import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { RunRecord } from "@/lib/server/contracts";
import { reconcileCloudJobs } from "@/lib/server/jobs";

const transport = vi.hoisted(() => ({ pendingRuns: vi.fn(), run: vi.fn(), saveRun: vi.fn(), cleanup: vi.fn(), trigger: vi.fn() }));
vi.mock("@/lib/server/cloud-repository", () => ({ CloudRepository: class {
  readonly mode = "cloud";
  pendingRuns = transport.pendingRuns;
  run = transport.run;
  saveRun = transport.saveRun;
  cleanup = transport.cleanup;
} }));
vi.mock("@/lib/server/config", () => ({ configuration: () => ({ trigger: true }) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: transport.trigger } }));

function pending(): RunRecord {
  const now = new Date().toISOString();
  return { id: randomUUID(), comparisonId: randomUUID(), documentId: randomUUID(), ownerId: randomUUID(), processingMode: "parse_only", stage: "queued", progress: 0, attempt: 0,
    fence: randomUUID(), inputRevision: 0, cancelRequested: false, createdAt: now, updatedAt: now, extractionVersion: 1, expectedHash: "a".repeat(64) };
}
beforeEach(() => {
  vi.resetAllMocks();
  transport.cleanup.mockResolvedValue(undefined);
  transport.trigger.mockResolvedValue({ id: "run_synthetic" });
  transport.saveRun.mockResolvedValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("cloud reconciliation with injected provider transport", () => {
  it("dispatches durable work before waiting for slow deletion and passes a cancellable maintenance deadline", async () => {
    const run = pending(); const events: string[] = [];
    transport.pendingRuns.mockResolvedValue([run]); transport.run.mockResolvedValue(run);
    transport.trigger.mockImplementation(async () => { events.push("dispatch"); return { id: "run_synthetic" }; });
    let finishCleanup!: () => void;
    transport.cleanup.mockImplementation(() => { events.push("cleanup"); return new Promise<void>(resolve => { finishCleanup = resolve; }); });
    const operation = reconcileCloudJobs();
    try {
      await vi.waitFor(() => expect(events).toEqual(["dispatch", "cleanup"]));
      const options = transport.cleanup.mock.calls[0][0] as { signal: AbortSignal };
      expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.signal.aborted).toBe(false);
      expect(transport.trigger).toHaveBeenCalledWith("fieldops-process-document", { runId: run.id }, { idempotencyKey: `${run.id}:${run.fence}`, idempotencyKeyTTL: "30d" });
      expect(transport.saveRun).toHaveBeenCalledWith(expect.objectContaining({ taskRunId: "run_synthetic", processingMode: "parse_only" }), run.fence);
    } finally { finishCleanup?.(); await operation; }
  });

  it("stops admitting more dispatches once the maintenance time budget is nearly spent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = Date.now(); const first = pending(), second = pending();
    transport.pendingRuns.mockResolvedValue([first, second]); transport.run.mockResolvedValue(first);
    transport.trigger.mockImplementation(async () => { vi.setSystemTime(started + 11000); return { id: "run_synthetic" }; });
    const deadline = vi.spyOn(AbortSignal, "timeout");
    await reconcileCloudJobs();
    expect(transport.trigger).toHaveBeenCalledTimes(1);
    expect(transport.trigger.mock.calls[0][1]).toEqual({ runId: first.id });
    expect(deadline).toHaveBeenCalledWith(4000);
    expect(transport.cleanup).toHaveBeenCalledTimes(1);
  });
});
