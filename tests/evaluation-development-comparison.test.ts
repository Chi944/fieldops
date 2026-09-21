import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareDevelopmentReports } from "../scripts/compare-development";

type Report = Parameters<typeof compareDevelopmentReports>[0];
// The immutable, synthetic-only before report is historical evidence. Changes below
// are in-memory test inputs and never written as measured after results.
async function beforeReport(): Promise<Report> {
  return JSON.parse(await readFile(path.join(process.cwd(), "eval/results/development/full-quotes-2026-09-21-v2/live-before.json"), "utf8")) as Report;
}
describe("immutable development before/after comparison", () => {
  it("keeps actual denominators and does not turn an unavailable before precision into numeric improvement", async () => {
    const before = await beforeReport(), after = structuredClone(before);
    after.phase = "after";
    after.configuration.sha256 = "TEST-ONLY-CHANGED-CONFIGURATION";
    after.fields!.statedFieldAccuracy = { numerator: 69, denominator: 138, value: 0.5 };
    after.fields!.lineItemPrecision = { numerator: 6, denominator: 6, value: 1 };
    const comparison = compareDevelopmentReports(before, after);
    expect(comparison.configurations.beforeChunkFailurePolicy).toBe("reject_document");
    expect(comparison.metrics.find(metric => metric.key === "statedFieldAccuracy")).toMatchObject({ before: { numerator: 0, denominator: 138 }, after: { numerator: 69, denominator: 138 }, percentagePointChange: 50 });
    expect(comparison.metrics.find(metric => metric.key === "lineItemPrecision")).toMatchObject({ before: { numerator: 0, denominator: 0, value: null }, percentagePointChange: null });
    expect(comparison.documents.map(document => document.id)).toEqual(["industrial-1", "translation-2", "office-2"]);
    expect(comparison.observedUsage.before).toMatchObject({ returnedResponses: 4, inputTokens: 10173, outputTokens: 4903 });
    expect(before.fields!.statedFieldAccuracy.numerator).toBe(0);
  });
  it("rejects changed cohorts or budgets, an unstable phase and non-development model activity", async () => {
    const before = await beforeReport();
    const after = structuredClone(before); after.phase = "after";
    const differentSource = structuredClone(after); differentSource.pair.selection[0].sha256 = "different";
    expect(() => compareDevelopmentReports(before, differentSource)).toThrow("same cohort and limits");
    const differentBudget = structuredClone(after); differentBudget.pair.limits.maxRequests = 100;
    expect(() => compareDevelopmentReports(before, differentBudget)).toThrow("same cohort and limits");
    const unstable = structuredClone(after); unstable.configurationStableDuringRun = false;
    expect(() => compareDevelopmentReports(before, unstable)).toThrow("changed configuration");
    const outside = structuredClone(after); outside.dataset.heldoutModelCalls = 1;
    expect(() => compareDevelopmentReports(before, outside)).toThrow("Only development");
  });
  it("references the original baseline under its exact hash without relabeling its measurement as a new run", async () => {
    const bytes = await readFile(path.join(process.cwd(), "eval/results/development/full-quotes-2026-09-21-v2/live-before.json"));
    const before = JSON.parse(bytes.toString("utf8")) as Report, after = structuredClone(before);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    after.name = "test-only-candidate-two"; after.phase = "after";
    after.baselineReference = { name: before.name, report: `eval/results/development/${before.name}/live-before.json`, sha256, configurationHash: before.configuration.sha256, measuredAt: before.measuredAt, model: before.configuration.model };
    const comparison = compareDevelopmentReports(before, after, sha256);
    expect(comparison.name).toBe(after.name);
    expect(comparison.baselineReference).toMatchObject({ name: before.name, measuredAt: before.measuredAt, sha256 });
    expect(() => compareDevelopmentReports(before, after)).toThrow("same cohort and limits");
    expect(() => compareDevelopmentReports(before, after, "changed-baseline-bytes")).toThrow("same cohort and limits");
    const differentModel = structuredClone(after); differentModel.configuration.model = "different-model";
    expect(() => compareDevelopmentReports(before, differentModel, sha256)).toThrow("same cohort and limits");
    expect(before.name).toBe("full-quotes-2026-09-21-v2");
  });
});
