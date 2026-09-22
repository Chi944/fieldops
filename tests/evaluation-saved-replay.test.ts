import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIResult } from "../src/lib/ai";
import { selectSavedTask } from "../scripts/replay-focused-date";
import { assertStopped } from "../scripts/report-interrupted-focused";

function saved(ids: string[], originalDisposition: "validated" | "rejected" = "validated") {
  const result: AIResult = { data: { coverage: ids.map(sourceId => ({ sourceId, disposition: "used", reason: "Synthetic evidence" })) }, model: "openai/gpt-oss-120b", inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, finishReason: "stop" };
  return { result, originalDisposition, sha256: "synthetic-response-hash" };
}

afterEach(() => vi.restoreAllMocks());

describe("saved-response study selection", () => {
  it("selects an exact evidence set irrespective of its original rejection, without changing it", () => {
    const response = saved(["target-1", "context-1"], "rejected"), before = structuredClone(response);
    expect(selectSavedTask([saved(["another-target"]), response], ["context-1", "target-1"])).toBe(response);
    expect(response).toEqual(before);
  });

  it("refuses a best-of choice between two complete responses", () => {
    expect(() => selectSavedTask([saved(["a"]), saved(["a"], "rejected")], ["a"])).toThrow(/exactly one/);
  });

  it.each([["a"], ["a", "a"], ["a", "b", "extra"], ["a", "wrong"]].map(ids => ({ ids })))("refuses missing, duplicate or different source sets: $ids", ({ ids }) => {
    expect(() => selectSavedTask([saved(ids)], ["a", "b"])).toThrow(/exactly one/);
  });

  it("refuses truncated or provider-schema-rejected responses and a different model", () => {
    const candidate = saved(["a"]);
    for (const result of [
      { ...candidate.result, finishReason: "length" },
      { ...candidate.result, model: "different-model" },
      { ...candidate.result, rejectedAt: "transport" as const },
    ]) expect(() => selectSavedTask([{ ...candidate, result }], ["a"])).toThrow(/exactly one/);
  });
});

describe("interrupted-study process check", () => {
  it("only accepts an absent recorded process", () => {
    const kill = vi.spyOn(process, "kill");
    kill.mockImplementation(() => { throw Object.assign(new Error("Absent"), { code: "ESRCH" }); });
    expect(() => assertStopped(123)).not.toThrow();
    expect(kill).toHaveBeenCalledWith(123, 0);
    kill.mockReturnValue(true);
    expect(() => assertStopped(123)).toThrow(/still active/);
    kill.mockImplementation(() => { throw Object.assign(new Error("Denied"), { code: "EPERM" }); });
    expect(() => assertStopped(123)).toThrow(/Cannot establish/);
  });

  it("never probes an invalid PID", () => {
    const kill = vi.spyOn(process, "kill");
    for (const pid of [0, -1, 1.5, NaN]) expect(() => assertStopped(pid)).toThrow(/Invalid/);
    expect(kill).not.toHaveBeenCalled();
  });
});
