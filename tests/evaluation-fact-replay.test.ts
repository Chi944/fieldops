import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertFactReplayReport, assertReplayConfiguration, parseFactReplayArguments, replaySavedResponse, ReplayUnavailableError, PreservedReplayRejection, type SavedReplayResponse } from "../scripts/replay-development-facts";
import { AIInterpretationError, compactExtractionRequest, DEFAULT_MODEL, PROMPT_VERSION, type AIRequest, type AIResult } from "@/lib/ai/groq";
import { extractQuotation } from "@/lib/ai";
import { parseDocument } from "@/lib/processing";
import { auditRetainedQuotation } from "../scripts/audit-development-sections";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const response = (data: unknown): AIResult => ({ data, model: DEFAULT_MODEL, inputTokens: 100, outputTokens: 50, elapsedMs: 40, costUsd: "0", usageAvailable: true, finishReason: "stop" });
const saved = (data: unknown, overrides: Partial<AIResult> = {}, code = "invalid_output"): SavedReplayResponse => ({ kind: "rejected_record", sha256: "a".repeat(64), value: { code, cached: false, result: { ...response(data), rejectedAt: "transport", ...overrides } } });
const raw = () => ({ facts: [
  ["description", "Widget", "text"], ["identifier", "W-1", "text"], ["quantity", "2", "decimal"], ["unit", "each", "text"], ["unitPrice", "10", "decimal"], ["lineAmount", "20", "decimal"],
].map(([key, value, type]) => ({ section: "item", entity: "i1", key, type, value, raw: value, state: "value", sourceIds: ["s0"] })), excluded: [], uncertainties: [] });
const request = (): AIRequest => ({ purpose: "extraction", transport: "quotation-v8", chunkFailurePolicy: "retain_valid_chunks_v1", system: "Synthetic test", schema: {}, maxOutputTokens: 3600, user: JSON.stringify({ document: "synthetic", section: 1, totalSections: 1, sources: [{ id: "synthetic:row", text: "Widget W-1 quantity 2 each unit price 10 line amount 20" }], context: [] }) });
function report() { return { name: "synthetic-replay", phase: "after", mode: "live", startedAt: "2026-09-23T00:00:00Z", measuredAt: "2026-09-23T00:01:00Z", configurationStableDuringRun: true, configuration: { extractionTransport: "fact_ledger_v1", chunkFailurePolicy: "retain_valid_chunks_v1", sha256: "a".repeat(64), model: DEFAULT_MODEL }, dataset: { split: "dev", synthetic: true, requestedDocuments: 3, heldoutDocumentsRead: 0, heldoutModelCalls: 0 }, pair: { split: "dev", mode: "live", synthetic: true, selection: ["industrial-1", "translation-2", "office-2"].map(id => ({ id, sha256: "b".repeat(64), goldSha256: "c".repeat(64) })) }, measurements: ["industrial-1", "translation-2", "office-2"].map(id => ({ id, status: "rejected" })) }; }
function identity(changed: string | string[] = []) {
  const changedFiles = typeof changed === "string" ? [changed] : changed;
  const body = { promptVersion: PROMPT_VERSION, model: DEFAULT_MODEL, chunkFailurePolicy: "retain_valid_chunks_v1", extractionTransport: "fact_ledger_v1", runtime: { node: "v24.synthetic", platform: "win32", architecture: "x64", ocrSha256: null }, files: ["src/lib/ai/index.ts", "src/lib/ai/groq.ts", "src/lib/ai/schema.ts", "src/lib/ai/fact-transport.ts"].map(file => ({ file, sha256: changedFiles.includes(file) ? "b".repeat(64) : "a".repeat(64) })) };
  return { ...body, sha256: sha(body) } as Parameters<typeof assertReplayConfiguration>[0];
}

describe("offline fact-ledger replay boundaries", () => {
  it("requires finalized stable fixed development scope and the exact fact retention contract", () => {
    const original = report(); expect(() => assertFactReplayReport(original, original.name)).not.toThrow();
    for (const changed of [
      { ...original, measuredAt: undefined }, { ...original, configurationStableDuringRun: false },
      { ...original, dataset: { ...original.dataset, split: "heldout" } },
      { ...original, pair: { ...original.pair, selection: [...original.pair.selection].reverse() } },
      { ...original, configuration: { ...original.configuration, extractionTransport: "typed_fields_v2" } },
      { ...original, configuration: { ...original.configuration, chunkFailurePolicy: "reject_document" } },
      { ...original, measurements: original.measurements.slice(1) },
    ]) expect(() => assertFactReplayReport(changed, original.name)).toThrow();
  });

  it("permits only decoder drift, retaining prompt, model, runtime, schema and measured-file identities", () => {
    expect(assertReplayConfiguration(identity(), identity("src/lib/ai/fact-transport.ts"))).toEqual(["src/lib/ai/fact-transport.ts"]);
    expect(() => assertReplayConfiguration(identity(), identity("src/lib/ai/schema.ts"))).toThrow(/Only the fact decoder/);
    const invalidHash = identity(); invalidHash.sha256 = "0".repeat(64);
    expect(() => assertReplayConfiguration(identity(), invalidHash)).toThrow(/identity is invalid/);
    const changedPrompt = identity(); changedPrompt.promptVersion = "different"; const { sha256: _old, ...body } = changedPrompt; void _old; changedPrompt.sha256 = sha(body);
    expect(() => assertReplayConfiguration(identity(), changedPrompt)).toThrow(/prompt/);
  });

  it("allows integration drift only in the explicit tier-range variant while keeping every other configuration fence", () => {
    const permitted = ["src/lib/ai/index.ts", "src/lib/ai/fact-transport.ts"];
    expect(() => assertReplayConfiguration(identity(), identity("src/lib/ai/index.ts"))).toThrow(/Only the fact decoder/);
    expect(() => assertReplayConfiguration(identity(), identity(permitted), "root-alias")).toThrow(/Only the fact decoder/);
    expect(assertReplayConfiguration(identity(), identity(permitted), "tier-range")).toEqual(permitted);
    for (const extra of ["src/lib/ai/schema.ts", "src/lib/ai/groq.ts"]) expect(() => assertReplayConfiguration(identity(), identity([...permitted, extra]), "tier-range")).toThrow(/Only the fact decoder and tier evidence/);
    const changedPrompt = identity(permitted); changedPrompt.promptVersion = "changed"; const { sha256: _old, ...body } = changedPrompt; void _old; changedPrompt.sha256 = sha(body);
    expect(() => assertReplayConfiguration(identity(), changedPrompt, "tier-range")).toThrow(/prompt/);
  });

  it("requires the exact opt-in CLI variant and cannot select arbitrary replay patches or overwrite names", () => {
    expect(parseFactReplayArguments(["--name", "synthetic-replay"])).toEqual({ name: "synthetic-replay", variant: "root-alias" });
    expect(parseFactReplayArguments(["--name", "synthetic-replay", "--variant", "tier-range"])).toEqual({ name: "synthetic-replay", variant: "tier-range" });
    for (const args of [["--name", "../outside"], ["--name", "synthetic-replay", "--variant", "anything"], ["--name", "synthetic-replay", "--variant", "tier-range", "--force"], ["--name", "synthetic-replay", "--variant"]]) expect(() => parseFactReplayArguments(args)).toThrow();
  });

  it("decodes eligible saved stop responses with real source aliases and no syntax/value repair", () => {
    const result = replaySavedResponse(request(), saved(JSON.stringify(raw())), DEFAULT_MODEL);
    expect(result.rejectedAt).toBeUndefined(); expect(result.data).toMatchObject({ items: [{ fields: expect.arrayContaining([expect.objectContaining({ key: "quantity", value: "2", sourceIds: ["synthetic:row"] })]) }] });
    expect(() => replaySavedResponse(request(), saved('{"facts":'), DEFAULT_MODEL)).toThrow(AIInterpretationError);
    const invalid = raw(); invalid.facts.find(fact => fact.key === "quantity")!.value = "2 each";
    expect(() => replaySavedResponse(request(), saved(invalid), DEFAULT_MODEL)).toThrow(AIInterpretationError);
    const foreign = raw(); foreign.facts[0].sourceIds = ["foreign"];
    expect(() => replaySavedResponse(request(), saved(foreign), DEFAULT_MODEL)).toThrow(AIInterpretationError);
  });

  it("preserves recorded provider/truncation failures without even reading their forbidden generated payload", () => {
    for (const sample of [saved(raw(), { finishReason: "provider_schema_rejected" }), saved(raw(), { providerError: { code: "provider_error", message: "PRIVATE" } }), saved(raw(), { finishReason: "length" })]) {
      const read = vi.fn(() => { throw new Error("Forbidden payload read"); });
      Object.defineProperty((sample.value as { result: AIResult }).result, "data", { get: read });
      expect(() => replaySavedResponse(request(), sample, DEFAULT_MODEL)).toThrow(PreservedReplayRejection);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("stops for unavailable metadata, missing data or operational failures instead of inventing rejected sections", () => {
    for (const sample of [saved(raw(), { finishReason: undefined }), saved(null), saved(raw(), {}, "quota"), saved(raw(), {}, "model_error")]) {
      expect(() => replaySavedResponse(request(), sample, DEFAULT_MODEL)).toThrow(ReplayUnavailableError);
    }
    expect(() => replaySavedResponse({ ...request(), transport: "quotation-v7" }, saved(raw()), DEFAULT_MODEL)).toThrow(ReplayUnavailableError);
  });

  it("retains good sections beside the unchanged recorded failure and keeps its exact targets price-blocking", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const text = Array.from({ length: 4 }, (_, index) => `Widget W-${index + 1} quantity 2 each unit price 10 line amount 20`).join("\n");
      const parsed = await parseDocument({ documentId: "synthetic", filename: "synthetic.txt", text });
      const quotation = await extractQuotation(parsed, { extractionTransport: "fact_ledger_v1", chunkFailurePolicy: "retain_valid_chunks_v1", request: async original => {
        const body = JSON.parse(original.user) as { section: number; sources: unknown[] };
        if (body.section > 1) return replaySavedResponse(original, saved(raw(), { finishReason: "provider_schema_rejected", usageAvailable: false }), DEFAULT_MODEL);
        const data = raw();
        for (let index = 1; index < body.sources.length; index++) (data.excluded as unknown[]).push({ sourceIds: [`s${index}`], disposition: "header", reason: "Synthetic unresolved row" });
        return replaySavedResponse(original, saved(data), DEFAULT_MODEL);
      } });
      expect(quotation.status).toBe("partial"); expect(quotation.items).toHaveLength(1);
      const audit = auditRetainedQuotation(quotation, parsed);
      expect(audit).toMatchObject({ sectionCountsAgree: true, originalSourceArrayPreserved: true, validatedSections: 1, rejectedSections: 1 });
      expect(audit.failedTargets).toMatchObject({ exactPlannedSectionSets: true, allRemainBlocking: true });
      expect(audit.costGuard).toMatchObject({ passes: true, costRecommendations: 0 });
    } finally { info.mockRestore(); }
  });

  it("revalidates expanded accepted and domain-rejected records through real extraction evidence guards", async () => {
    const noNetwork = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Network prohibited in replay test"); });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const parsed = await parseDocument({ documentId: "synthetic", filename: "synthetic.txt", text: "Widget W-1 quantity 2 each unit price 10 line amount 20" });
    try {
      const quotation = await extractQuotation(parsed, { extractionTransport: "fact_ledger_v1", chunkFailurePolicy: "retain_valid_chunks_v1", request: async original => replaySavedResponse(original, saved(raw()), DEFAULT_MODEL) });
      expect(quotation.items).toHaveLength(1); expect(quotation.items[0].unitPrice.value).toBe("10");
      for (const kind of ["accepted_checkpoint", "rejected_record"] as const) {
        const rejection = vi.fn();
        await expect(extractQuotation(parsed, { extractionTransport: "fact_ledger_v1", chunkFailurePolicy: "retain_valid_chunks_v1", checkpoint: { get: async () => null, set: vi.fn(), reject: rejection }, request: async original => {
          const expanded = compactExtractionRequest(original).restore(raw()) as { items: { fields: { key: string; value: string }[] }[] };
          expanded.items[0].fields.find(field => field.key === "unitPrice")!.value = "999";
          const result = response(expanded);
          return replaySavedResponse(original, { kind, sha256: "a".repeat(64), value: kind === "accepted_checkpoint" ? result : { code: "invalid_evidence", result } }, DEFAULT_MODEL);
        } })).rejects.toMatchObject({ code: "invalid_output" });
        expect(rejection.mock.calls.some(call => call[2] === "invalid_evidence")).toBe(true);
      }
      expect(noNetwork).not.toHaveBeenCalled();
    } finally { noNetwork.mockRestore(); info.mockRestore(); }
  });
});
