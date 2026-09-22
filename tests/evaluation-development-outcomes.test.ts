import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentOutcomes, persistDevelopmentQuotation } from "../eval/development-outcomes";
import { developmentRequestController, parseDevelopmentOptions, requestReservation, summarizeDevelopmentUsage, type DevelopmentEvent } from "../eval/development-control";
import { aiRequestKey, AIInterpretationError, requestAI, type AICheckpoint, type AIRequest, type AIResult } from "../src/lib/ai/groq";
import { ProcessingError } from "../src/lib/processing/errors";
import { acquireModelStudyBudget, inspectModelStudyBudget } from "../eval/model-study-control";
import { evaluateDevelopment, writeImmutableJson } from "../scripts/evaluate-development";
import { emptyQuotation } from "../src/lib/domain/types";

const directories: string[] = [];
const model = "openai/gpt-oss-120b", configurationHash = "c".repeat(64), at = "2026-09-23T00:00:00.000Z";
const request: AIRequest = { purpose: "extraction", schema: {}, system: "Synthetic isolated test", user: "Synthetic", maxOutputTokens: 20 };
const response: AIResult = { model, data: { accepted: true }, inputTokens: 30, outputTokens: 10, elapsedMs: 2, costUsd: null, usageAvailable: true };
beforeEach(() => { vi.stubEnv("GROQ_MODEL", model); });
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fieldops-request-outcomes-")); directories.push(directory);
  const options = { directory, model, configurationHash, now: () => Date.parse(at) };
  const outcomes = await developmentOutcomes(options), key = aiRequestKey(request, model);
  const reserve = () => outcomes.reserve({ kind: "reservation", requestKey: key, documentId: "industrial-1", at, ...requestReservation(request, 1) });
  return { options, outcomes, key, reserve };
}
function checkpoint(outcomes: Awaited<ReturnType<typeof developmentOutcomes>>, accepted = new Map<string, AIResult>()): AICheckpoint {
  return { get: async key => { await outcomes.rejectIfSettled(key); return accepted.get(key) ?? null; }, set: async (key, result) => { accepted.set(key, result); }, reject: (key, result, code, context) => outcomes.reject(key, result, code, context?.cached ?? false, "industrial-1").then(() => undefined) };
}

describe("development exact-request outcome resumption without model calls", () => {
  it("reuses an immutable completed quotation after revalidation or a missing completion receipt", async () => {
    const { options } = await setup(), quotation = emptyQuotation("industrial-1", "synthetic.txt"); quotation.status = "partial";
    const first = await persistDevelopmentQuotation(options.directory, "industrial-1", quotation);
    const bytes = await readFile(path.join(options.directory, first.path), "utf8");
    const revalidated = { ...quotation, extractedAt: at, usage: { inputTokens: 10, outputTokens: 4, elapsedMs: 2, costUsd: null, cachedRejectedResponses: 1 } };
    expect(await persistDevelopmentQuotation(options.directory, "industrial-1", revalidated)).toEqual(first);
    await unlink(path.join(options.directory, "document-completions/industrial-1.json"));
    expect(await persistDevelopmentQuotation(options.directory, "industrial-1", revalidated)).toEqual(first);
    expect(await readdir(path.join(options.directory, "outputs"))).toHaveLength(1);
    expect(await readFile(path.join(options.directory, first.path), "utf8")).toBe(bytes);
    const changed = structuredClone(revalidated); changed.statedTotal.value = "100";
    await expect(persistDevelopmentQuotation(options.directory, "industrial-1", changed)).rejects.toThrow("differs");
  });
  it("refuses a sealed interrupted study before loading its requested environment file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fieldops-sealed-study-test-")); directories.push(root);
    await writeImmutableJson(path.join(root, "eval/development/gold.json"), { rights: "self-authored synthetic", split: "dev", robustness: [], documents: ["industrial-1", "translation-2", "office-2"].map(id => ({ id, split: "dev" })) });
    await writeImmutableJson(path.join(root, "eval/results/development/sealed-study/interrupted-before.json"), { status: "interrupted" });
    const options = parseDevelopmentOptions(["--name", "sealed-study", "--phase", "before", "--live", "--env-file", ".env.ai.local", "--comparison-kind", "model", "--model", model]);
    await expect(evaluateDevelopment(options, root)).rejects.toThrow("sealed as interrupted");
  });
  it("recovers a response after ledger fsync but before journal logging across a UTC-day boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fieldops-cross-day-outcomes-")); directories.push(root);
    const directory = path.join(root, "eval/runs/private/development/synthetic-study/live-before"); await mkdir(directory, { recursive: true });
    let now = Date.parse("2026-09-23T23:59:58.000Z");
    const budget = await acquireModelStudyBudget({ root, name: "synthetic-study", phase: "before", configurationHash, allocationTokens: 90000, now: () => now });
    const outcomes = await developmentOutcomes({ directory, configurationHash, model, now: () => now });
    const event = await budget.annotate({ kind: "reservation", at: new Date(now).toISOString(), documentId: "industrial-1", requestKey: aiRequestKey(request, model), ...requestReservation(request, 1) });
    await outcomes.reserve(event);
    const filename = path.join(directory, "usage.jsonl"); await writeFile(filename, JSON.stringify(event) + "\n");
    now += 6000;
    const highUsage = { ...response, inputTokens: 90000, outputTokens: 10000 };
    await outcomes.dispatch(async () => highUsage)(request);
    await budget.annotate({ kind: "response", at: new Date(now).toISOString(), documentId: "industrial-1", requestKey: event.requestKey, inputTokens: 90000, outputTokens: 10000, usageAvailable: true });
    // Simulate termination before the response event reaches the journal.
    await budget.close();
    const recovered = await developmentOutcomes({ directory, configurationHash, model, now: () => now });
    const events: DevelopmentEvent[] = [event];
    await recovered.recover(events, async item => { await appendFile(filename, JSON.stringify(item) + "\n"); });
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ returnedResponses: 1, inputTokens: 90000, outputTokens: 10000 });
    expect(await inspectModelStudyBudget(root, 90000, Date.parse("2026-09-23T23:59:59Z"))).toMatchObject({ committedEstimatedTokens: 100000 });
    expect(await inspectModelStudyBudget(root, 90000, now)).toMatchObject({ committedEstimatedTokens: 0 });
    const after = await acquireModelStudyBudget({ root, name: "synthetic-study", phase: "after", configurationHash, allocationTokens: 90000, now: () => now });
    expect(after.lastActivity()).toBe(new Date(now).toISOString());
    expect(after.current().committedEstimatedTokens).toBe(90000);
    await after.close();
    expect((await recovered.recover(events, async () => { throw new Error("duplicate usage"); })).recoveredEvents).toBe(0);
  });
  it("replays a terminal domain rejection as cached without a second provider attempt or wait", async () => {
    const { options, outcomes, reserve } = await setup();
    const provider = vi.fn(async () => response), dispatch = outcomes.dispatch(provider);
    const controller = vi.fn(async (input: AIRequest) => { await reserve(); return dispatch(input); });
    const validate = () => { throw new ProcessingError("invalid_evidence", "Synthetic validation failure"); };
    await expect(requestAI(request, { request: outcomes.wrap(controller), checkpoint: checkpoint(outcomes) }, validate)).rejects.toBeInstanceOf(AIInterpretationError);
    const resumed = await developmentOutcomes(options), fresh = vi.fn(async () => response);
    await expect(requestAI(request, { request: resumed.wrap(fresh), checkpoint: checkpoint(resumed) }, validate)).rejects.toMatchObject({ code: "invalid_evidence", usage: { cached: true } });
    expect(provider).toHaveBeenCalledOnce(); expect(controller).toHaveBeenCalledOnce(); expect(fresh).not.toHaveBeenCalled();
  });
  it("revalidates returned-but-unvalidated output and recovers missing usage metadata exactly once", async () => {
    const { options, outcomes, reserve } = await setup();
    await reserve(); await outcomes.dispatch(async () => response)(request); // Crash before outer validation/logging.
    const resumed = await developmentOutcomes(options), events: DevelopmentEvent[] = [], persisted: DevelopmentEvent[] = [];
    expect(await resumed.recover(events, async event => { persisted.push(event); })).toEqual({ recoveredEvents: 2 });
    expect(await resumed.recover(events, async event => { persisted.push(event); })).toEqual({ recoveredEvents: 0 });
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ dispatches: 1, returnedResponses: 1, inputTokens: 30, outputTokens: 10, waitedMs: 0 });
    const fresh = vi.fn(async () => response), validator = vi.fn((result: AIResult) => result.data);
    const accepted = new Map<string, AIResult>();
    expect(await requestAI(request, { request: resumed.wrap(fresh), checkpoint: checkpoint(resumed, accepted) }, validator)).toEqual({ accepted: true });
    expect(validator).toHaveBeenCalledOnce(); expect(fresh).not.toHaveBeenCalled(); expect(accepted.size).toBe(1); expect(persisted).toHaveLength(2);
  });
  it("never retries a reserved request with an unknown outcome and refuses changed configuration", async () => {
    const { options, outcomes, reserve } = await setup(); await reserve();
    const fresh = vi.fn(async () => response);
    await expect(outcomes.wrap(fresh)(request)).rejects.toMatchObject({ code: "development_unknown_outcome" });
    const changed = await developmentOutcomes({ ...options, configurationHash: "d".repeat(64) });
    await expect(changed.wrap(fresh)(request)).rejects.toMatchObject({ code: "development_outcome_storage" });
    expect(fresh).not.toHaveBeenCalled();
  });
  it("keeps provider/schema rejection receipts rejected without decoding or duplicate response usage", async () => {
    const { options, outcomes, key, reserve } = await setup(); await reserve();
    const rejected: AIResult = { ...response, data: "SYNTHETIC-RAW-DO-NOT-DECODE", finishReason: "provider_schema_rejected", rejectedAt: "transport", usageAvailable: false };
    await outcomes.reject(key, rejected, "invalid_output", false, "industrial-1");
    const resumed = await developmentOutcomes(options), events: DevelopmentEvent[] = [];
    await resumed.recover(events, async () => {});
    await resumed.recover(events, async () => {});
    const fresh = vi.fn(async () => response), validator = vi.fn();
    await expect(requestAI(request, { request: resumed.wrap(fresh), checkpoint: checkpoint(resumed) }, validator)).rejects.toMatchObject({ code: "invalid_output", usage: { cached: true } });
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ returnedResponses: 1, responsesWithoutUsage: 1, inputTokens: 0, outputTokens: 0, rejections: 1 });
    expect(fresh).not.toHaveBeenCalled(); expect(validator).not.toHaveBeenCalled();
  });
  it("replays an operational failure without manufacturing a returned response or retrying", async () => {
    const { options, outcomes, reserve } = await setup(); await reserve();
    await expect(outcomes.dispatch(async () => { throw new ProcessingError("quota", "Synthetic quota", false, 60000); })(request)).rejects.toMatchObject({ code: "quota" });
    const resumed = await developmentOutcomes(options), events: DevelopmentEvent[] = [], fresh = vi.fn(async () => response);
    await resumed.recover(events, async () => {});
    await expect(resumed.wrap(fresh)(request)).rejects.toMatchObject({ code: "quota", retryAfterMs: 60000 });
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ returnedResponses: 0, failures: 1, dispatches: 1 });
    expect(fresh).not.toHaveBeenCalled();
  });
  it("revalidates accepted checkpoints but terminally rejects newly invalid cached data without dispatch", async () => {
    const { outcomes, reserve } = await setup(), accepted = new Map<string, AIResult>();
    const provider = vi.fn(async () => response), dispatch = outcomes.dispatch(provider);
    await requestAI(request, { checkpoint: checkpoint(outcomes, accepted), request: outcomes.wrap(async input => { await reserve(); return dispatch(input); }) }, result => result.data);
    const fresh = vi.fn(async () => response);
    await expect(requestAI(request, { checkpoint: checkpoint(outcomes, accepted), request: outcomes.wrap(fresh) }, () => { throw new ProcessingError("invalid_evidence", "Synthetic cache mismatch"); })).rejects.toMatchObject({ code: "invalid_evidence", usage: { cached: true } });
    expect(provider).toHaveBeenCalledOnce(); expect(fresh).not.toHaveBeenCalled();
  });
  it("counts only completed pacing waits and uses known usage above estimates for the next admission", async () => {
    let now = Date.parse(at) + 1000;
    const events: DevelopmentEvent[] = [{ kind: "reservation", at, attemptSlots: 1, reservedTokens: 10 }, { kind: "response", at, inputTokens: 80, outputTokens: 10, usageAvailable: true }];
    const provider = vi.fn(async () => response);
    const blocked = developmentRequestController({ limits: { maxRequests: 12, maxReservedTokens: 100, maxWaitMs: 720000 }, events, persist: async () => {}, request: provider, maxTransportAttempts: 1 });
    await expect(blocked.request(request)).rejects.toMatchObject({ code: "evaluation_budget" }); expect(provider).not.toHaveBeenCalled();
    const waiting = developmentRequestController({ limits: { maxRequests: 12, maxReservedTokens: 90000, maxWaitMs: 720000 }, events: [events[0]], persist: async () => {}, request: provider, maxTransportAttempts: 1, durableWaits: true, now: () => now, wait: async () => { throw new Error("Synthetic process interruption during wait"); } });
    await expect(waiting.request(request)).rejects.toThrow("interruption during wait");
    now += 60000;
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not offset an unknown request's reservation against another request's overrun", async () => {
    const events: DevelopmentEvent[] = [
      { kind: "reservation", at, requestKey: "a".repeat(64), attemptSlots: 1, reservedTokens: 40 },
      { kind: "response", at, requestKey: "a".repeat(64), usageAvailable: false, inputTokens: 0, outputTokens: 0 },
      { kind: "reservation", at, requestKey: "b".repeat(64), attemptSlots: 1, reservedTokens: 40 },
      { kind: "response", at, requestKey: "b".repeat(64), usageAvailable: true, inputTokens: 60, outputTokens: 10 },
    ];
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ reservedTokens: 80, inputTokens: 60, outputTokens: 10, accountedTokenFloor: 110 });
    const provider = vi.fn(async () => response);
    const controller = developmentRequestController({ limits: { maxRequests: 12, maxReservedTokens: 100, maxWaitMs: 720000 }, events, persist: async () => {}, request: provider, maxTransportAttempts: 1 });
    await expect(controller.request(request)).rejects.toMatchObject({ code: "evaluation_budget" }); expect(provider).not.toHaveBeenCalled();
  });
});
