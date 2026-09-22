import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDevelopmentEnvironment, assertDevelopmentIds, developmentRequestController, parseDevelopmentOptions, requestReservation, responseEvent, summarizeDevelopmentUsage, unsourcedMissingStateAgreements, type DevelopmentEvent } from "../eval/development-control";
import { evaluateDevelopment, readDevelopmentManifest, writeImmutableJson } from "../scripts/evaluate-development";
import type { AIRequest, AIResult } from "../src/lib/ai/groq";
import { emptyItem, emptyQuotation } from "../src/lib/domain/types";

const request: AIRequest = { purpose: "extraction", schema: {}, system: "Self-authored fixture test", user: "Synthetic test", maxOutputTokens: 100 };
const response: AIResult = { data: {}, model: "TEST-ONLY-NO-PROVIDER", inputTokens: 9, outputTokens: 4, elapsedMs: 3, usageAvailable: true, costUsd: null };
const limits = { maxRequests: 24, maxReservedTokens: 170000, maxWaitMs: 600000 };
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temporaryDirectory() { const directory = await mkdtemp(path.join(os.tmpdir(), "fieldops-development-evaluation-")); directories.push(directory); return directory; }

describe("development-only evaluation selection and artifacts", () => {
  it("fixes the initial complete quotation cohort and rejects widened split, ID, environment and budget options", () => {
    const options = parseDevelopmentOptions(["--name", "complete-quotes", "--phase", "before"]);
    expect(options).toMatchObject({ live: false, documentIds: ["industrial-1", "translation-2", "office-2"], ...limits });
    for (const split of ["all", "heldout"]) expect(() => parseDevelopmentOptions(["--name", "complete-quotes", "--phase", "before", "--split", split])).toThrow("Only the development split");
    for (const ids of [[], ["industrial-1", "industrial-1"], ["not-a-development-id"], ["../industrial-1"]]) expect(() => assertDevelopmentIds(ids)).toThrow("allowlisted");
    for (const extra of [["--env-file", ".env.cloud.local"], ["--max-requests", "25"], ["--max-reserved-tokens", "170001"], ["--max-wait-ms", "600001"], ["--allow-posthoc"], ["--mode", "baseline", "--live"]]) expect(() => parseDevelopmentOptions(["--name", "complete-quotes", "--phase", "before", ...extra])).toThrow();
    expect(parseDevelopmentOptions(["--name", "candidate-two", "--phase", "after", "--live", "--baseline-name", "original-before"])).toMatchObject({ baselineName: "original-before", phase: "after", live: true });
    for (const args of [["--phase", "before", "--live", "--baseline-name", "original-before"], ["--phase", "after", "--baseline-name", "original-before"], ["--phase", "after", "--live", "--baseline-name", "../original-before"], ["--phase", "after", "--live", "--baseline-name", "candidate-two"]]) expect(() => parseDevelopmentOptions(["--name", "candidate-two", ...args])).toThrow("baseline-name");
    expect(options.chunkFailurePolicy).toBe("reject_document");
    expect(options.extractionTransport).toBe("legacy_v5");
    expect(parseDevelopmentOptions(["--name", "fact-candidate", "--phase", "after", "--live", "--extraction-transport", "fact_ledger_v1"]).extractionTransport).toBe("fact_ledger_v1");
    expect(() => parseDevelopmentOptions(["--name", "fact-candidate", "--phase", "after", "--extraction-transport", "fact_ledger_v1"])).toThrow();
    expect(parseDevelopmentOptions(["--name", "candidate-three", "--phase", "after", "--live", "--chunk-failure-policy", "retain_valid_chunks_v1"]).chunkFailurePolicy).toBe("retain_valid_chunks_v1");
    for (const args of [["--phase", "before", "--live"], ["--phase", "after"]]) expect(() => parseDevelopmentOptions(["--name", "candidate-three", ...args, "--chunk-failure-policy", "retain_valid_chunks_v1"])).toThrow("explicit live after");
    expect(() => parseDevelopmentOptions(["--name", "candidate-three", "--phase", "after", "--live", "--chunk-failure-policy", "repair-invalid-values"])).toThrow("supported explicit");
  });
  it("rejects inherited cloud and preload settings without revealing their values", () => {
    for (const key of ["FIELDOPS_DATABASE_URL", "DATABASE_URL", "NEON_AUTH_COOKIE_SECRET", "TRIGGER_SECRET_KEY", "VERCEL_ENV", "SUPABASE_URL", "NODE_OPTIONS", "NODE_PRELOAD"]) {
      expect(() => assertDevelopmentEnvironment({ [key]: "SENSITIVE-TEST-VALUE" })).toThrow("clean local shell");
      try { assertDevelopmentEnvironment({ [key]: "SENSITIVE-TEST-VALUE" }); } catch (error) { expect(String(error)).not.toContain("SENSITIVE"); }
    }
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "production" })).toThrow();
    expect(() => assertDevelopmentEnvironment({ NODE_ENV: "test", GROQ_API_KEY: "TEST-ONLY" })).not.toThrow();
  });
  it("reads only the separate development manifest and rejects a mixed manifest before selecting documents", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "eval/development/gold.json");
    await writeImmutableJson(file, { version: "test", rights: "self-authored fictional test", verification: "test", split: "dev", robustness: [], documents: [{ id: "industrial-1", split: "dev" }, { id: "office-2", split: "heldout" }] });
    await expect(readDevelopmentManifest(root)).rejects.toThrow("Non-development records");
    // No combined gold exists in this temporary root; the error establishes which file was read.
  });
  it("validates programmatic selection before credentials or source reads and refuses final report replacement", async () => {
    const root = await temporaryDirectory();
    const options = parseDevelopmentOptions(["--name", "complete-quotes", "--phase", "before", "--live"]);
    await expect(evaluateDevelopment({ ...options, documentIds: ["not-development"] }, root)).rejects.toThrow("allowlisted");
    const filename = path.join(root, "immutable.json");
    await writeImmutableJson(filename, { before: "original result" });
    const original = await readFile(filename, "utf8");
    await expect(writeImmutableJson(filename, { before: "replacement" })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(filename, "utf8")).toBe(original);
  });
  it("counts unsourced matching missing-state defaults separately without changing the historical score", () => {
    const quotation = emptyQuotation("test", "synthetic.txt"); quotation.items = [emptyItem("actual-row")];
    const fixture = { fields: ["terms.warranty", "items.gold-row.minimumOrder"].map(path => ({ path, state: "not_stated" as const, value: null, critical: false, sourceKey: "test-source" })) };
    const mapped = { "gold-row": "actual-row" };
    expect(unsourcedMissingStateAgreements(fixture, quotation, mapped)).toBe(2);
    quotation.terms.warranty.sourceIds = ["source-stating-no-warranty"];
    expect(unsourcedMissingStateAgreements(fixture, quotation, mapped)).toBe(1);
    quotation.items[0].minimumOrder.state = "ambiguous";
    expect(unsourcedMissingStateAgreements(fixture, quotation, mapped)).toBe(0);
    expect(fixture.fields.map(field => field.state)).toEqual(["not_stated", "not_stated"]);
  });
});

describe("durable development request and token ceilings without model calls", () => {
  it("reserves the application's two possible transport attempts before dispatch and does not retry semantic failure", async () => {
    const persisted: DevelopmentEvent[] = [], events: DevelopmentEvent[] = [];
    const provider = vi.fn(async () => {
      expect(persisted[0]).toMatchObject({ kind: "reservation", ...requestReservation(request) });
      throw Object.assign(new Error("Synthetic semantic validation failure"), { code: "invalid_output" });
    });
    const controller = developmentRequestController({ limits, events, request: provider, persist: async event => { persisted.push(event); } });
    await expect(controller.request(request)).rejects.toMatchObject({ code: "invalid_output" });
    expect(provider).toHaveBeenCalledOnce();
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ dispatches: 1, reservedAttemptSlots: 2, returnedResponses: 0, failures: 1 });
  });
  it("retains interrupted reservations across processes and blocks before dispatch when either ceiling is exhausted", async () => {
    const prior: DevelopmentEvent = { kind: "reservation", at: "2026-09-21T00:00:00.000Z", attemptSlots: 24, reservedTokens: 100 };
    const provider = vi.fn().mockResolvedValue(response);
    const requestBound = developmentRequestController({ limits, events: [prior], request: provider, persist: async () => {} });
    await expect(requestBound.request(request)).rejects.toMatchObject({ code: "evaluation_budget" });
    const tokenBound = developmentRequestController({ limits, events: [{ ...prior, attemptSlots: 2, reservedTokens: 170000 }], request: provider, persist: async () => {} });
    await expect(tokenBound.request(request)).rejects.toMatchObject({ code: "evaluation_budget" });
    expect(provider).not.toHaveBeenCalled();
  });
  it("paces from the persisted reservation before taking new slots, with a bounded wait", async () => {
    const started = Date.parse("2026-09-21T00:00:00.000Z"); let now = started + 2500;
    const events: DevelopmentEvent[] = [{ kind: "reservation", at: new Date(started).toISOString(), ...requestReservation(request) }];
    const wait = vi.fn(async (ms: number) => { expect(events.filter(event => event.kind === "reservation")).toHaveLength(1); now += ms; });
    const provider = vi.fn(async () => { expect(now).toBe(started + 60000); return response; });
    const controller = developmentRequestController({ limits, events, request: provider, persist: async () => {}, wait, now: () => now });
    await controller.request(request);
    expect(wait).toHaveBeenCalledExactlyOnceWith(57500);
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ reservedAttemptSlots: 4, waitedMs: 57500, returnedResponses: 1 });
    const stopped = developmentRequestController({ limits: { ...limits, maxWaitMs: 0 }, events, request: provider, persist: async () => {}, wait, now: () => now });
    await expect(stopped.request(request)).rejects.toMatchObject({ code: "evaluation_wait_budget" });
    expect(provider).toHaveBeenCalledOnce();
  });
  it("bounds provider quota waits and keeps their reservations rather than refunding unknown usage", async () => {
    let now = Date.parse("2026-09-21T00:00:00.000Z"); const events: DevelopmentEvent[] = [];
    const provider = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Quota"), { code: "quota", retryAfterMs: 5000 })).mockResolvedValue(response);
    const wait = vi.fn(async (ms: number) => { now += ms; });
    const controller = developmentRequestController({ limits, events, request: provider, persist: async () => {}, wait, now: () => now });
    await controller.request(request);
    expect(wait.mock.calls.map(call => call[0])).toEqual([5000, 55000]);
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ reservedAttemptSlots: 4, waitedMs: 60000, failures: 1, returnedResponses: 1 });
    const daily = developmentRequestController({ limits, events: [], request: async () => { throw Object.assign(new Error("Daily quota"), { code: "quota", retryAfterMs: 86400000 }); }, persist: async () => {}, wait });
    await expect(daily.request(request)).rejects.toMatchObject({ code: "quota" });
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it("paces after SDK/provider settlement instead of the earlier reservation timestamp", async () => {
    let now = Date.parse("2026-09-21T00:00:00.000Z"); const events: DevelopmentEvent[] = [];
    const dispatchTimes: number[] = [];
    const provider = vi.fn(async () => { dispatchTimes.push(now); now += 4700; return response; });
    const wait = vi.fn(async (ms: number) => { now += ms; });
    const controller = developmentRequestController({ limits, events, request: provider, persist: async () => {}, wait, now: () => now });
    await controller.request(request);
    // A new process restores the same durable events; quota pacing survives resume.
    const resumed = developmentRequestController({ limits, events: [...events], request: provider, persist: async () => {}, wait, now: () => now });
    await resumed.request(request);
    expect(wait).toHaveBeenCalledExactlyOnceWith(60000);
    expect(dispatchTimes[1] - dispatchTimes[0]).toBe(64700);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("denies matching calls and reports missing usage separately from known zero or returned token totals", async () => {
    const provider = vi.fn().mockResolvedValue(response);
    const controller = developmentRequestController({ limits, events: [], request: provider, persist: async () => {} });
    await expect(controller.request({ ...request, purpose: "matching" })).rejects.toMatchObject({ code: "development_scope" });
    expect(provider).not.toHaveBeenCalled();
    const usage = summarizeDevelopmentUsage([
      { kind: "response", at: "test", inputTokens: 9, outputTokens: 4, elapsedMs: 5, usageAvailable: true },
      { kind: "response", at: "test", inputTokens: 999, outputTokens: 999, elapsedMs: 6, usageAvailable: false },
      { kind: "rejection", at: "test", code: "invalid_output", cached: false },
    ]);
    expect(usage).toMatchObject({ returnedResponses: 2, responsesWithoutUsage: 1, inputTokens: 9, outputTokens: 4, responseElapsedMs: 11, rejections: 1, providerInvoiceUsd: null });
    expect(summarizeDevelopmentUsage([responseEvent({ ...response, usageAvailable: undefined })])).toMatchObject({ returnedResponses: 1, responsesWithoutUsage: 1, inputTokens: 0, outputTokens: 0 });
  });
});
