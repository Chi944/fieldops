import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIRequest, AICheckpoint } from "../src/lib/ai/groq";

const create = vi.hoisted(() => vi.fn());
vi.mock("groq-sdk", () => ({ default: class { chat = { completions: { create } }; } }));
const privateMarker = "SYNTHETIC-CONTENT-NOT-FOR-PUBLIC-DIAGNOSTICS";
const request: AIRequest = {
  purpose: "extraction", transport: "quotation-v4", schema: {}, system: "Synthetic test only", maxOutputTokens: 20,
  user: JSON.stringify({ sources: [{ id: "document:private-source-path", text: privateMarker }], context: [{ id: "document:context", text: "Currency: USD" }] }),
};
const empty = () => ({ fields: [], items: [], charges: [], excluded: [], uncertainties: [] });

beforeEach(() => {
  vi.resetModules(); create.mockReset();
  vi.stubEnv("FIELDOPS_PROCESSING_MODE", "ai");
  vi.stubEnv("GROQ_API_KEY", "TEST-ONLY-NOT-A-REAL-KEY");
  vi.stubEnv("GROQ_FREE_TIER_CONFIRMED", "true");
  vi.stubEnv("GROQ_ZDR_CONFIRMED", "true");
  vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("transport validation diagnostics without document disclosure", () => {
  it("keeps malformed JSON a hard failure under the partial-coverage policy", async () => {
    const malformed = `"fields":[],"items":[],"charges":[],"excluded":[],"uncertainties":[]`;
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: malformed } }], usage: { prompt_tokens: 17, completion_tokens: 23 } });
    const checkpoint: AICheckpoint = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined), reject: vi.fn().mockResolvedValue(undefined) };
    const { requestAI } = await import("../src/lib/ai/groq");
    await expect(requestAI({ ...request, transport: "quotation-v5" }, { checkpoint }, result => result)).rejects.toMatchObject({ code: "invalid_output", message: "The model did not return valid structured data. Retry the failed section." });
    expect(create).toHaveBeenCalledOnce(); expect(checkpoint.set).not.toHaveBeenCalled();
    expect(checkpoint.reject).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ data: malformed }), "invalid_output", { cached: false });
  });

  it.each([
    {
      name: "invalid item shape",
      data: { ...empty(), items: [{ sourceIds: ["s0"], note: privateMarker }] },
      code: "invalid_output",
      message: "The model output did not match the bounded quotation transport schema.",
    },
    {
      name: "unaccounted source coverage",
      data: empty(),
      code: "invalid_output",
      message: "The model omitted an unreferenced source from its coverage explanation.",
    },
    {
      name: "known context incorrectly excluded as a target",
      data: { ...empty(), excluded: [{ sourceIds: ["s0", "s1"], disposition: "non_quotation", reason: "Synthetic exclusion" }] },
      code: "invalid_output",
      message: "Source coverage contains an unknown, repeated or already-used exclusion.",
    },
    {
      name: "repeated known evidence reference",
      data: { ...empty(), fields: [{ key: "name", type: "text", state: "value", value: privateMarker, raw: privateMarker, sourceIds: ["s0", "s0"] }] },
      code: "invalid_evidence",
      message: "A transport reference did not belong to the supplied sources.",
    },
  ])("preserves the static cause of $name instead of relabelling it as a foreign citation", async ({ data, code, message }) => {
    create.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 17, completion_tokens: 23 } });
    const checkpoint: AICheckpoint = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined), reject: vi.fn().mockResolvedValue(undefined) };
    const { requestAI } = await import("../src/lib/ai/groq");
    const error = await requestAI(request, { checkpoint }, result => result).catch(error => error);
    expect(error).toMatchObject({ code, message });
    expect(error).not.toHaveProperty("result");
    expect(error.usage).toEqual({ inputTokens: 17, outputTokens: 23, elapsedMs: expect.any(Number), costUsd: "0", usageAvailable: true, cached: false });
    expect(JSON.stringify(error)).not.toContain(privateMarker);
    expect(JSON.stringify(error)).not.toContain("private-source-path");
    expect(checkpoint.set).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(checkpoint.reject).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ data, inputTokens: 17, outputTokens: 23, rejectedAt: "transport", finishReason: "stop" }), code, { cached: false });
    const logs = vi.mocked(console.info).mock.calls.flat().join(" ");
    expect(logs).not.toContain(privateMarker);
    expect(logs).not.toContain("private-source-path");
  });
});
