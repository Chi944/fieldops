import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AICheckpoint, AIRequest, AIResult } from "../src/lib/ai/groq";

const create = vi.hoisted(() => vi.fn());
vi.mock("groq-sdk", () => ({ default: class { chat = { completions: { create } }; } }));
const oss = "openai/gpt-oss-120b";
const qwen = "qwen/qwen3.8-27b";
const request: AIRequest = { purpose: "explanation", schema: { type: "object", properties: {}, required: [], additionalProperties: false }, system: "Synthetic model configuration test", user: "{}", maxOutputTokens: 20 };
const response = { choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } };

beforeEach(() => {
  vi.resetModules(); create.mockReset(); create.mockResolvedValue(response);
  for (const key of Object.keys(process.env)) {
    if (/^(?:NEON_|TRIGGER_|VERCEL|AWS_|SUPABASE_|NEXT_PUBLIC_SUPABASE_)/.test(key) || ["DATABASE_URL", "FIELDOPS_DATABASE_URL", "NODE_OPTIONS", "NODE_PRELOAD", "GROQ_BASE_URL"].includes(key)) vi.stubEnv(key, "");
  }
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FIELDOPS_PROCESSING_MODE", "ai");
  vi.stubEnv("GROQ_API_KEY", "TEST-ONLY-NOT-A-REAL-KEY");
  vi.stubEnv("GROQ_FREE_TIER_CONFIRMED", "true");
  vi.stubEnv("GROQ_ZDR_CONFIRMED", "true");
  vi.stubEnv("GROQ_MODEL", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("explicit model request profiles", () => {
  it.each([oss, "openai/gpt-oss-20b"])("keeps %s on the established low-reasoning wire profile", async model => {
    if (model !== oss) vi.stubEnv("GROQ_MODEL", model);
    const { requestAI, DEFAULT_MODEL, liveAIConfiguration } = await import("../src/lib/ai/groq");
    expect(DEFAULT_MODEL).toBe(oss);
    expect(liveAIConfiguration()).toEqual({ ready: true, model, reason: null });
    await requestAI(request);
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({ model, reasoning_effort: "low", temperature: 0, max_completion_tokens: 20, response_format: { type: "json_schema", json_schema: { strict: true, schema: request.schema } } });
    expect(body).not.toHaveProperty("reasoning_format");
    expect(body).not.toHaveProperty("include_reasoning");
    expect(body).not.toHaveProperty("stream");
    expect(body).not.toHaveProperty("tools");
  });

  it("uses the documented Qwen none/hidden settings only after explicit local opt-in", async () => {
    vi.stubEnv("GROQ_MODEL", qwen);
    const { requestAI, liveAIConfiguration, requireLiveAI, groqModelProfile } = await import("../src/lib/ai/groq");
    expect(liveAIConfiguration().ready).toBe(false);
    expect(() => requireLiveAI()).toThrow(/explicit local development opt-in/);
    expect(liveAIConfiguration({ allowPreviewModel: true })).toEqual({ ready: true, model: qwen, reason: null });
    expect(groqModelProfile(qwen)).toEqual({ version: "qwen3.8-none-hidden-v1", reasoning_effort: "none", reasoning_format: "hidden" });
    await requestAI(request, { allowPreviewModel: true });
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({ model: qwen, reasoning_effort: "none", reasoning_format: "hidden", temperature: 0, response_format: { type: "json_schema", json_schema: { strict: true } } });
    for (const key of ["include_reasoning", "top_k", "min_p", "presence_penalty", "stream", "tools"]) expect(body).not.toHaveProperty(key);
  });

  it.each([
    ["FIELDOPS_PROCESSING_MODE", "parse_only"], ["GROQ_API_KEY", ""], ["GROQ_FREE_TIER_CONFIRMED", "false"], ["GROQ_ZDR_CONFIRMED", "false"],
  ])("retains the %s guard for an opted-in preview", async (key, value) => {
    vi.stubEnv("GROQ_MODEL", qwen); vi.stubEnv(key, value);
    const { requestAI, liveAIConfiguration } = await import("../src/lib/ai/groq");
    expect(liveAIConfiguration({ allowPreviewModel: true }).ready).toBe(false);
    await expect(requestAI(request, { allowPreviewModel: true })).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["NODE_ENV", "production"], ["VERCEL", "1"], ["AWS_EXECUTION_ENV", "synthetic-lambda"], ["AWS_REGION", "synthetic-region"],
    ["TRIGGER_SECRET_KEY", "synthetic"], ["NEON_AUTH_BASE_URL", "https://synthetic.invalid"], ["SUPABASE_URL", "https://synthetic.invalid"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid"], ["DATABASE_URL", "synthetic"], ["FIELDOPS_DATABASE_URL", "synthetic"],
    ["NODE_OPTIONS", "synthetic"], ["NODE_PRELOAD", "synthetic"], ["GROQ_BASE_URL", "https://synthetic.invalid"],
  ])("rejects preview in %s before reading a checkpoint or calling a request function", async (key, value) => {
    vi.stubEnv("GROQ_MODEL", qwen); vi.stubEnv(key, value);
    const checkpoint: AICheckpoint = { get: vi.fn(), set: vi.fn() };
    const injected = vi.fn();
    const { requestAI, liveAIConfiguration } = await import("../src/lib/ai/groq");
    expect(liveAIConfiguration({ allowPreviewModel: true }).ready).toBe(false);
    await expect(requestAI(request, { allowPreviewModel: true, checkpoint, request: injected }, result => result)).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(checkpoint.get).not.toHaveBeenCalled(); expect(injected).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it("does not allow a preview checkpoint to bypass missing explicit opt-in", async () => {
    vi.stubEnv("GROQ_MODEL", qwen);
    const checkpoint: AICheckpoint = { get: vi.fn(), set: vi.fn() };
    const { requestAI } = await import("../src/lib/ai/groq");
    await expect(requestAI(request, { checkpoint }, result => result)).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(checkpoint.get).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it("never enables an unknown model through the preview option", async () => {
    vi.stubEnv("GROQ_MODEL", "unknown/provider-model");
    const { requestAI, liveAIConfiguration, groqModelProfile } = await import("../src/lib/ai/groq");
    expect(liveAIConfiguration({ allowPreviewModel: true }).ready).toBe(false);
    expect(() => groqModelProfile("unknown/provider-model")).toThrow(/no supported request profile/);
    await expect(requestAI(request, { allowPreviewModel: true })).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves historical OSS checkpoint identity and separates the preview profile", async () => {
    const entries = new Map<string, AIResult>();
    const checkpoint: AICheckpoint = { get: vi.fn(async key => entries.get(key) ?? null), set: vi.fn(async (key, value) => { entries.set(key, value); }) };
    const { requestAI, PROMPT_VERSION, groqModelProfile } = await import("../src/lib/ai/groq");
    await requestAI(request, { checkpoint, allowPreviewModel: true }, result => result);
    const historicalKey = createHash("sha256").update(JSON.stringify({ version: PROMPT_VERSION, model: oss, request })).digest("hex");
    expect(entries.has(historicalKey)).toBe(true);
    await requestAI(request, { checkpoint }, result => result);
    expect(create).toHaveBeenCalledTimes(1);
    vi.stubEnv("GROQ_MODEL", qwen);
    await requestAI(request, { checkpoint, allowPreviewModel: true }, result => result);
    const previewKey = createHash("sha256").update(JSON.stringify({ version: PROMPT_VERSION, model: qwen, request, modelProfile: groqModelProfile(qwen).version })).digest("hex");
    expect(previewKey).not.toBe(historicalKey); expect(entries.has(previewKey)).toBe(true);
    await requestAI(request, { checkpoint, allowPreviewModel: true }, result => result);
    expect(create).toHaveBeenCalledTimes(2); expect(entries.size).toBe(2);
  });

  it("allows an explicit single transport attempt without changing the default retry policy", async () => {
    const { requestAI } = await import("../src/lib/ai/groq");
    create.mockRejectedValue({ status: 503 });
    await expect(requestAI(request, { maxTransportAttempts: 1 })).rejects.toMatchObject({ code: "model_error", retryable: true });
    expect(create).toHaveBeenCalledTimes(1);
    create.mockReset(); create.mockRejectedValueOnce({ status: 503 }).mockResolvedValue(response);
    await expect(requestAI(request)).resolves.toMatchObject({ data: {} });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
