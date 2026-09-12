import { describe, expect, it, vi } from "vitest";
import { liveRequestController, type LiveEvent } from "../eval/live-control";
import { ProcessingError } from "../src/lib/processing";
import type { AIRequest, AIResult } from "../src/lib/ai";

const input: AIRequest = { purpose: "extraction", schema: {}, system: "Synthetic test only", user: "Synthetic test only", maxOutputTokens: 100 };
const output: AIResult = { data: {}, model: "TEST-ONLY", inputTokens: 8, outputTokens: 4, elapsedMs: 3, costUsd: null };
describe("bounded live evaluation sessions without provider calls", () => {
  it("halts the entire session on quota so later matching cannot issue extra calls", async () => {
    const events: LiveEvent[] = [], provider = vi.fn().mockRejectedValue(new ProcessingError("quota", "Synthetic quota", true, 5000));
    const control = liveRequestController({ request: provider, persist: async event => { events.push(event); } });
    await expect(control.request(input)).rejects.toMatchObject({ code: "quota" });
    await expect(control.request({ ...input, purpose: "matching" })).rejects.toMatchObject({ code: "quota" });
    expect(provider).toHaveBeenCalledOnce();
    expect(control.state.halt?.retryAfterMs).toBe(5000);
    expect(events.map(event => event.event)).toEqual(["request_started", "request_failed"]);
  });
  it("honors a short quota delay and logs actual response usage without any document content", async () => {
    const events: LiveEvent[] = [], wait = vi.fn().mockResolvedValue(undefined);
    const provider = vi.fn().mockRejectedValueOnce(new ProcessingError("quota", "Synthetic quota", true, 2345)).mockResolvedValue(output);
    const control = liveRequestController({ request: provider, waitQuota: true, wait, persist: async event => { events.push(event); } });
    expect(await control.request(input)).toEqual(output);
    expect(wait).toHaveBeenCalledExactlyOnceWith(2345);
    expect(control.state).toMatchObject({ quotaWaits: 1, waitedMs: 2345, completedResponses: 1, halt: null });
    expect(events.at(-1)).toMatchObject({ event: "response_received", inputTokens: 8, outputTokens: 4, model: "TEST-ONLY" });
    expect(JSON.stringify(events)).not.toContain(input.user);
  });
  it("bounds repeated waits, daily quota delays and explicit request budgets", async () => {
    const wait = vi.fn().mockResolvedValue(undefined), persist = async () => {};
    const provider = vi.fn().mockRejectedValue(new ProcessingError("quota", "Synthetic quota", true, 1000));
    const control = liveRequestController({ request: provider, waitQuota: true, maxQuotaWaits: 2, wait, persist });
    await expect(control.request(input)).rejects.toMatchObject({ code: "quota" });
    expect(provider).toHaveBeenCalledTimes(3); expect(wait).toHaveBeenCalledTimes(2);
    const daily = liveRequestController({ request: async () => { throw new ProcessingError("quota", "Daily budget", true, 86_400_000); }, waitQuota: true, wait, persist });
    await expect(daily.request(input)).rejects.toMatchObject({ code: "quota" });
    expect(daily.state.quotaWaits).toBe(0);
    const smoke = liveRequestController({ request: async () => output, maxNewRequests: 1, persist });
    await smoke.request(input);
    await expect(smoke.request(input)).rejects.toMatchObject({ code: "evaluation_budget" });
    expect(smoke.state.completedResponses).toBe(1);
  });
});
