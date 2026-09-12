import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComparisonPoller } from "@/lib/client/comparison-polling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("private comparison polling", () => {
  it("updates active processing and stops all idle polls when sources are ready", async () => {
    const refresh = vi.fn().mockResolvedValueOnce([{ stage: "parsing" }]).mockResolvedValue([{ stage: "source_ready" }]);
    const poller = createComparisonPoller({ refresh, isVisible: () => true });
    await poller.refresh();
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    poller.stop();
  });
  it("pauses hidden tabs and refreshes on return even for completed or empty comparisons", async () => {
    let visible = true;
    const refresh = vi.fn().mockResolvedValueOnce([{ stage: "extracting" }]).mockResolvedValue([]);
    const poller = createComparisonPoller({ refresh, isVisible: () => visible });
    await poller.refresh(); visible = false; poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = true; poller.visibilityChanged(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(2);
    poller.visibilityChanged(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(3);
    poller.stop();
  });
  it("restarts active polling after an explicit upload or retry refresh", async () => {
    const refresh = vi.fn().mockResolvedValue([{ stage: "ready" }]);
    const poller = createComparisonPoller({ refresh, isVisible: () => true });
    await poller.refresh();
    poller.observe([{ stage: "queued" }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(2);
    poller.stop();
  });
  it.each(["old-empty-result", "old-read-error"])("preserves an explicit queued observation over an in-flight %s", async (outcome) => {
    let finish!: (value: { stage: "queued" }[]) => void;
    let fail!: (error: Error) => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<{ stage: "queued" }[]>((resolve, reject) => { finish = resolve; fail = reject; }))
      .mockResolvedValue([{ stage: "source_ready" }]);
    const poller = createComparisonPoller({ refresh, isVisible: () => true });
    const pending = poller.refresh();
    // Upload finalization refreshes independently and observes its newly queued job.
    poller.observe([{ stage: "queued" }]);
    if (outcome === "old-empty-result") finish([]); else fail(new Error("Older request failed"));
    await pending;
    await vi.advanceTimersByTimeAsync(2999); expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(2);
    poller.stop();
  });
  it("waits until the saved quota deadline and leaves manual quota waits idle", async () => {
    const refresh = vi.fn().mockResolvedValue([{ stage: "waiting_quota" }]);
    const poller = createComparisonPoller({ refresh, isVisible: () => true });
    poller.observe([{ stage: "waiting_quota", retryAfter: new Date(Date.now() + 60_000).toISOString() }]);
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000); expect(refresh).toHaveBeenCalledTimes(1);
    poller.stop();
  });
  it("never overlaps slow refreshes or schedules new work after disposal", async () => {
    let finish!: (value: { stage: "parsing" }[]) => void;
    const refresh = vi.fn(() => new Promise<{ stage: "parsing" }[]>(resolve => { finish = resolve; }));
    const poller = createComparisonPoller({ refresh, isVisible: () => true });
    const pending = poller.refresh();
    poller.visibilityChanged(); await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    poller.stop(); finish([{ stage: "parsing" }]); await pending;
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated outage requests and allows a focus recovery", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("Synthetic outage"));
    const poller = createComparisonPoller({ refresh, isVisible: () => true });
    await poller.refresh(); await vi.advanceTimersByTimeAsync(3_600_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    refresh.mockResolvedValue([]); poller.visibilityChanged(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(4);
    poller.stop();
  });
});
