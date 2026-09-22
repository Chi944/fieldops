import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertFocusedAuditReport, auditFocusedDevelopment, auditFocusedQuotation, parseFocusedAuditArguments } from "../scripts/audit-focused-development";
import { MODEL_STUDY_METRIC_VERSION } from "../eval/model-study-control";
import { planFocusedExtraction } from "../src/lib/ai/focused-transport";
import { extractionChunks } from "../src/lib/ai/chunks";
import { parseDocument } from "../src/lib/processing";
import { emptyItem, emptyQuotation, field, type Quotation } from "../src/lib/domain/types";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cohort = ["industrial-1", "translation-2", "office-2"];
function report() {
  const identity = { comparisonKind: "model", model: "openai/gpt-oss-120b", extractionTransport: "focused_fields_v1", chunkFailurePolicy: "retain_valid_chunks_v1", maxTransportAttempts: 1, files: [], runtime: { node: "synthetic" } };
  return { name: "synthetic-audit", phase: "before", mode: "live", startedAt: "2026-09-23T00:00:00Z", measuredAt: "2026-09-23T00:01:00Z", configurationStableDuringRun: true,
    configuration: { ...identity, sha256: digest(identity) }, pair: { comparisonKind: "model", metricVersion: MODEL_STUDY_METRIC_VERSION, selection: cohort.map(id => ({ id })) },
    dataset: { split: "dev", synthetic: true, requestedDocuments: 3, heldoutDocumentsRead: 0, heldoutModelCalls: 0 }, measurements: cohort.map(id => ({ id, status: "partial" })) };
}
async function syntheticRetained() {
  const text = ["Supplier: Synthetic audit only", "Currency: USD", ...Array.from({ length: 6 }, (_, index) => `${index + 1}. Widget | ID W${index + 1} | quantity 2 each | unit price 10 | line amount 20`), "Payment: Net 30"].join("\n");
  const parsed = await parseDocument({ documentId: "synthetic-audit-only", filename: "synthetic.txt", text });
  const tasks = planFocusedExtraction(parsed), row = tasks[0].sources[0];
  const item = emptyItem("synthetic-retained-row"); item.sourceIds = [row.id]; item.kind = "goods"; item.taxBasis = "exclusive";
  item.description = field("Widget", [row.id]); item.identifier = field("W1", [row.id]); item.quantity = field("2", [row.id]); item.unit = field("each", [row.id]); item.unitPrice = field("10", [row.id]); item.lineAmount = field("20", [row.id]); item.currency = field("USD", [parsed.sources[1].id]);
  const quotation: Quotation = { ...emptyQuotation(parsed.documentId, parsed.filename), ...structuredClone(parsed), status: "partial", items: [item], usage: { inputTokens: 0, outputTokens: 0, elapsedMs: 0, costUsd: null, acceptedSections: tasks.length - 1, rejectedSections: 1 },
    issues: [{ id: "synthetic-failure", code: "incomplete_extraction", severity: "error", message: `Section 2 of ${tasks.length} failed interpretation validation (invalid_evidence). Its model response was discarded.`, documentId: parsed.documentId, sourceIds: tasks[1].sources.map(source => source.id), resolved: false }] };
  return { parsed, tasks, quotation };
}
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("offline focused audit scope", () => {
  it("allows only named before/after phases and finalized stable focused model-study reports", () => {
    expect(parseFocusedAuditArguments(["--name", "synthetic-audit", "--phase", "before"])).toEqual({ name: "synthetic-audit", phase: "before" });
    for (const args of [["--name", "../outside", "--phase", "after"], ["--name", "synthetic-audit"], ["--name", "synthetic-audit", "--phase", "after", "--live"], ["--name", "synthetic-audit", "--phase", "heldout"]]) expect(() => parseFocusedAuditArguments(args)).toThrow();
    const original = report(); expect(() => assertFocusedAuditReport(original, original.name, "before")).not.toThrow();
    const changed = [
      { ...original, measuredAt: undefined }, { ...original, configurationStableDuringRun: false }, { ...original, phase: "after" },
      { ...original, configuration: { ...original.configuration, extractionTransport: "legacy_v5" } },
      { ...original, configuration: { ...original.configuration, maxTransportAttempts: 2 } },
      { ...original, dataset: { ...original.dataset, split: "heldout" } },
      { ...original, pair: { ...original.pair, selection: [...original.pair.selection].reverse() } },
      { ...original, measurements: original.measurements.slice(1) },
    ];
    for (const value of changed) expect(() => assertFocusedAuditReport(value, original.name, "before")).toThrow();
    const corruptHash = structuredClone(original); corruptHash.configuration.sha256 = "0".repeat(64);
    expect(() => assertFocusedAuditReport(corruptHash, original.name, "before")).toThrow("configuration hash");
  });
  it("stops on an unfinalized phase before touching private outputs or originals", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fieldops-focused-audit-test-")); directories.push(root);
    await expect(auditFocusedDevelopment("synthetic-audit", "before", root)).rejects.toThrow("no finalized report");
  });
});

describe("focused planner and retained-value audit", () => {
  it("uses the focused two-item task partition rather than legacy chunks and blocks retained prices", async () => {
    const { parsed, tasks, quotation } = await syntheticRetained();
    expect(tasks).toHaveLength(4);
    expect(extractionChunks(parsed).length).not.toBe(tasks.length);
    const before = structuredClone(quotation), audit = auditFocusedQuotation(quotation, parsed);
    expect(audit).toMatchObject({ plannedTasks: 4, attemptedTasks: 4, validatedTasks: 3, rejectedTasks: 1, taskCountsAgree: true, originalSourceArrayPreserved: true });
    expect(audit.failedTargets).toMatchObject({ numerator: 2, denominator: parsed.sources.length, allResolvable: true, exactPlannedTaskSets: true, allRemainBlocking: true });
    expect(audit.fieldReferences).toMatchObject({ statedFields: 7, references: 7, resolvable: 7, allResolvable: true, statedFieldsWithoutReferences: 0 });
    expect(audit.costGuard).toMatchObject({ retainedValuesChecked: 1, explicitlyCoverageBlockedValues: 1, costRecommendations: 0, passes: true });
    expect(quotation).toEqual(before);
    const sanitized = JSON.stringify(audit);
    expect(sanitized).not.toContain("Synthetic audit only"); expect(sanitized).not.toContain(parsed.sources[0].id); expect(sanitized).not.toContain("Widget");
  });
  it("detects source mutation, foreign references and missing source evidence without accepting output", async () => {
    const { parsed, quotation } = await syntheticRetained();
    quotation.sources[0].text = "MUTATED SOURCE";
    quotation.items[0].unitPrice.sourceIds = ["foreign-source"];
    quotation.items[0].quantity.sourceIds = [];
    const audit = auditFocusedQuotation(quotation, parsed);
    expect(audit.originalSourceArrayPreserved).toBe(false);
    expect(audit.fieldReferences).toMatchObject({ allResolvable: false, statedFieldsWithoutReferences: 1 });
    expect(audit.originalSourceArraySha256).not.toBe(audit.retainedSourceArraySha256);
  });
  it("detects repeated-context substitutions, resolved failure issues and inconsistent task metadata", async () => {
    const { parsed, tasks, quotation } = await syntheticRetained();
    expect(tasks[1].context.length).toBeGreaterThan(0);
    quotation.issues[0].sourceIds = tasks[1].context.map(source => source.id);
    quotation.issues[0].resolved = true;
    quotation.usage!.acceptedSections = tasks.length;
    const audit = auditFocusedQuotation(quotation, parsed);
    expect(audit.failedTargets).toMatchObject({ allResolvable: true, exactPlannedTaskSets: false, allRemainBlocking: false });
    expect(audit.taskCountsAgree).toBe(false);
    expect(audit.costGuard.passes).toBe(false);
  });
  it("does not call a clean output's cost probe a coverage-blocking pass", async () => {
    const { parsed, quotation } = await syntheticRetained(); quotation.issues = []; delete quotation.usage;
    const audit = auditFocusedQuotation(quotation, parsed);
    expect(audit).toMatchObject({ plannedTasks: 4, validatedTasks: 4, rejectedTasks: 0, taskCountsAgree: true });
    expect(audit.costGuard.passes).toBeNull();
  });
});
