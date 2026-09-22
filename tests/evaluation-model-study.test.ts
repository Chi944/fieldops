import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireModelStudyBudget, assertComparableModelConfigurations, inspectModelStudyBudget } from "../eval/model-study-control";
import { developmentRequestController, parseDevelopmentOptions, requestReservation, summarizeDevelopmentUsage, unattemptedDevelopmentScore, type DevelopmentEvent } from "../eval/development-control";
import { readDevelopmentManifest } from "../scripts/evaluate-development";
import { aggregateExtractionMetrics } from "../eval/metrics";
import type { AIRequest, AIResult } from "../src/lib/ai/groq";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const at = "2026-09-23T01:00:00.000Z";
const configurationHash = "a".repeat(64);
async function temporary() { const root = await mkdtemp(path.join(os.tmpdir(), "fieldops-model-study-")); directories.push(root); await mkdir(path.join(root, "eval/runs/private/development"), { recursive: true }); return root; }
async function journal(root: string, name: string, phase: "before" | "after", events: DevelopmentEvent[]) { const filename = path.join(root, "eval/runs/private/development", name, `live-${phase}`, "usage.jsonl"); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, events.map(event => JSON.stringify(event)).join("\n") + "\n"); return filename; }
const reservation = (tokens: number, date = at): DevelopmentEvent => ({ kind: "reservation", at: date, attemptSlots: 2, reservedTokens: tokens });
const request: AIRequest = { purpose: "extraction", schema: {}, system: "Synthetic", user: "Synthetic", maxOutputTokens: 10 };
const result: AIResult = { data: {}, model: "INJECTED-NO-PROVIDER", inputTokens: 3, outputTokens: 2, elapsedMs: 1, costUsd: null, usageAvailable: true };

describe("explicit fixed-cohort model comparison", () => {
  it("keeps historical defaults while requiring an explicit allowed model and full cohort", () => {
    const args = ["--name", "synthetic-study", "--phase", "before", "--live", "--comparison-kind", "model", "--model", "openai/gpt-oss-120b", "--chunk-failure-policy", "retain_valid_chunks_v1", "--extraction-transport", "focused_fields_v1"];
    expect(parseDevelopmentOptions(args)).toMatchObject({ maxRequests: 12, maxReservedTokens: 60000, maxWaitMs: 720000, comparisonKind: "model" });
    for (const extra of [["--documents", "industrial-1"], ["--baseline-name", "old-study"], ["--max-requests", "13"], ["--max-reserved-tokens", "60001"]]) expect(() => parseDevelopmentOptions([...args, ...extra])).toThrow();
    expect(() => parseDevelopmentOptions(args.map(value => value === "openai/gpt-oss-120b" ? "unapproved-model" : value))).toThrow();
    expect(() => parseDevelopmentOptions(["--name", "synthetic-study", "--phase", "before", "--live", "--model", "qwen/qwen3.8-27b"])).toThrow("comparison-kind");
    expect(parseDevelopmentOptions(["--name", "synthetic-study", "--phase", "before"])).toMatchObject({ maxRequests: 24, maxReservedTokens: 170000, maxWaitMs: 600000 });
  });
  it("allows only model/profile differences, never a simultaneous code/runtime/policy change", () => {
    const before = { model: "openai/gpt-oss-120b", modelProfile: { version: "oss" }, files: [{ file: "synthetic", sha256: "a" }], runtime: { node: "test" }, maxTransportAttempts: 1, extractionTransport: "focused_fields_v1" };
    const after = { ...before, model: "qwen/qwen3.8-27b", modelProfile: { version: "qwen" } };
    expect(() => assertComparableModelConfigurations(before, after)).not.toThrow();
    for (const mutation of [{ files: [] }, { runtime: { node: "other" } }, { maxTransportAttempts: 2 }, { extractionTransport: "legacy_v5" }, { model: before.model }]) expect(() => assertComparableModelConfigurations(before, { ...after, ...mutation })).toThrow("otherwise identical");
  });
  it("preserves all three documents' fixed recall denominators when every document was unattempted", async () => {
    const manifest = await readDevelopmentManifest(process.cwd());
    const fixtures = ["industrial-1", "translation-2", "office-2"].map(id => manifest.documents.find(fixture => fixture.id === id)!);
    const score = aggregateExtractionMetrics(fixtures.map(fixture => unattemptedDevelopmentScore(fixture, "model")!));
    expect(score.statedFieldAccuracy).toMatchObject({ numerator: 0, denominator: 138 });
    expect(score.criticalFieldAccuracy).toMatchObject({ numerator: 0, denominator: 129 });
    expect(score.lineItemRecall).toMatchObject({ numerator: 0, denominator: 18 });
    expect(unattemptedDevelopmentScore(fixtures[0])).toBeUndefined();
  });
});

describe("persistent aggregate free reservation budget", () => {
  it("seeds prior reservations once, permits one whole phase, blocks a second until the next UTC day", async () => {
    const root = await temporary(); let now = Date.parse(at);
    await journal(root, "prior-study", "after", [reservation(118920), { kind: "failure", at, code: "invalid_output" }]);
    expect(await inspectModelStudyBudget(root, 60000, now)).toMatchObject({ committedEstimatedTokens: 118920, remainingEstimatedTokens: 61080, phaseFits: true, fullPairFits: false });
    const first = await acquireModelStudyBudget({ root, name: "model-study", phase: "before", configurationHash, allocationTokens: 60000, now: () => now });
    const marked = await first.annotate(reservation(3000, new Date(now + 1).toISOString()));
    await journal(root, "model-study", "before", [marked]);
    expect(first.current()).toMatchObject({ committedEstimatedTokens: 178920, remainingEstimatedTokens: 1080 });
    await first.close();
    // The journal's per-request reservation is covered by its full phase allocation.
    expect(await inspectModelStudyBudget(root, 60000, now)).toMatchObject({ committedEstimatedTokens: 178920 });
    await expect(acquireModelStudyBudget({ root, name: "model-study", phase: "after", configurationHash, allocationTokens: 60000, now: () => now })).rejects.toMatchObject({ code: "model_study_daily_budget" });
    now += 86400000;
    const next = await acquireModelStudyBudget({ root, name: "model-study", phase: "after", configurationHash, allocationTokens: 60000, now: () => now });
    expect(next.current()).toMatchObject({ committedEstimatedTokens: 60000, remainingEstimatedTokens: 120000 });
    await next.close();
    const ledger = await readFile(path.join(root, "eval/runs/private/development/_model-study/ledger.jsonl"), "utf8");
    expect(ledger).not.toContain("prior-study");
    expect(ledger).toContain('"kind":"blocked"');
  });
  it("serializes models and resumes an interrupted phase allocation without refunding or double charging", async () => {
    const root = await temporary(), options = { root, name: "model-study", phase: "before" as const, configurationHash, allocationTokens: 60000, now: () => Date.parse(at) };
    const first = await acquireModelStudyBudget(options);
    await expect(acquireModelStudyBudget({ ...options, phase: "after" })).rejects.toThrow("active or interrupted");
    await first.close();
    const resumed = await acquireModelStudyBudget(options);
    expect(resumed.current().committedEstimatedTokens).toBe(60000);
    await resumed.close();
    await expect(acquireModelStudyBudget({ ...options, allocationTokens: 50000 })).rejects.toThrow("allocation changed");
  });
  it("fails closed on duplicate, malformed or changed prior reservation metadata", async () => {
    const root = await temporary();
    const filename = await journal(root, "prior-study", "before", [reservation(1000)]);
    const options = { root, name: "model-study", phase: "before" as const, configurationHash, allocationTokens: 60000, now: () => Date.parse(at) };
    const first = await acquireModelStudyBudget(options); await first.close();
    await writeFile(filename, JSON.stringify(reservation(999)) + "\n");
    await expect(acquireModelStudyBudget(options)).rejects.toThrow("changed or disappeared");
    await writeFile(filename, [reservation(1000), reservation(1000)].map(event => JSON.stringify(event)).join("\n"));
    await expect(acquireModelStudyBudget(options)).rejects.toThrow("Duplicate development");
    await writeFile(filename, '{"kind":"reservation","at":"broken"}\n');
    await expect(acquireModelStudyBudget(options)).rejects.toThrow("timestamp");
    await writeFile(filename, '{"SENSITIVE-SYNTHETIC-METADATA"');
    await expect(acquireModelStudyBudget(options)).rejects.toThrow("Malformed shared budget metadata");
    try { await acquireModelStudyBudget(options); } catch (error) { expect(String(error)).not.toContain("SENSITIVE"); }
  });
  it("uses single-attempt reservations and common settlement pacing with no automatic quota retry", async () => {
    let now = Date.parse(at) + 5000; const events: DevelopmentEvent[] = [];
    const provider = vi.fn(async () => { throw Object.assign(new Error("Synthetic quota"), { code: "quota", retryAfterMs: 1000 }); });
    const wait = vi.fn(async (ms: number) => { now += ms; });
    const controller = developmentRequestController({ limits: { maxRequests: 12, maxReservedTokens: 60000, maxWaitMs: 720000 }, events, persist: async () => {}, request: provider, maxTransportAttempts: 1, retryQuota: false, lastSharedActivity: () => at, now: () => now, wait });
    await expect(controller.request(request)).rejects.toMatchObject({ code: "quota" });
    expect(wait).toHaveBeenCalledExactlyOnceWith(55000);
    expect(provider).toHaveBeenCalledOnce();
    expect(controller.halt).toBe("quota");
    expect(summarizeDevelopmentUsage(events)).toMatchObject({ reservedAttemptSlots: 1, reservedTokens: requestReservation(request, 1).reservedTokens });
    expect(requestReservation(request).reservedTokens).toBe(2 * requestReservation(request, 1).reservedTokens);
    expect(result.model).toBe("INJECTED-NO-PROVIDER");
  });
});
