import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authoredDataset, FORMAT_ORDER } from "../eval/specifications";
import { scoreExtraction, scoreFailedExtraction, aggregateExtractionMetrics, scoreMatches } from "../eval/metrics";
import { DatasetManifest } from "../scripts/generate-fixtures";
import { evaluate, parseOptions } from "../scripts/evaluate";
import { proposeMatches } from "../src/lib/domain/matching";
import { field } from "../src/lib/domain/types";

const manifest = async () => JSON.parse(await readFile(path.join(process.cwd(), "eval/gold.json"), "utf8")) as DatasetManifest;
afterEach(() => vi.unstubAllEnvs());
describe("reproducible benchmark integrity", () => {
  it("balances six formats across scenario-isolated dev and held-out splits", () => {
    const dataset = authoredDataset(); expect(dataset).toHaveLength(24);
    for (const split of ["dev", "heldout"]) {
      const documents = dataset.filter(d => d.split === split); expect(documents).toHaveLength(12);
      expect(documents.map(d => d.format)).toEqual(FORMAT_ORDER);
      expect(new Set(documents.map(d => d.scenarioId)).size).toBe(4);
      expect(documents.flatMap(d => d.quotation.items)).toHaveLength(72);
    }
    expect(new Set(dataset.map(d => d.id)).size).toBe(24);
    const dev = new Set(dataset.filter(d => d.split === "dev").map(d => d.scenarioId));
    expect(dataset.filter(d => d.split === "heldout").every(d => !dev.has(d.scenarioId))).toBe(true);
  });
  it("stored originals match every gold source hash", async () => {
    const gold = await manifest();
    for (const document of gold.documents) {
      const bytes = await readFile(path.join(process.cwd(), document.path));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(document.sha256);
      expect(bytes.length).toBe(document.sizeBytes);
      expect(document.quotation.sources.length).toBeGreaterThan(0);
      for (const expected of document.fields) expect(document.fieldLocations[expected.path].length).toBeGreaterThan(0);
    }
    expect(gold.robustness).toHaveLength(8);
    expect(gold.robustness.every(r => !gold.documents.some(d => d.path === r.path))).toBe(true);
  });
  it("reports false equivalence on hard negatives instead of rewarding true-negative abundance", async () => {
    const gold = (await manifest()).documents.filter(d => d.scenarioId === "industrial");
    const groups = proposeMatches(gold.map(d => d.quotation));
    const alternative = groups.find(g => g.classification === "alternative")!;
    expect(alternative).toBeDefined();
    const safe = scoreMatches(gold, groups); alternative.classification = "equivalent";
    const unsafe = scoreMatches(gold, groups);
    expect(unsafe.falsePositive).toBeGreaterThan(safe.falsePositive);
    expect(unsafe.hardNegativeFalseEquivalences.numerator).toBeGreaterThan(0);
    expect(unsafe.equivalentPrecision.value).toBeLessThan(1);
  });
  it("does not conflate 12.30 with 123.00 in field scoring", async () => {
    const gold = (await manifest()).documents[0];
    gold.fields = [{ path: `items.${gold.quotation.items[0].id}.unitPrice`, value: "12.30", state: "value", critical: true, sourceKey: "line-1" }];
    const actual = structuredClone(gold.quotation); actual.items[0].unitPrice = field("123.00");
    const parsed = { documentId: gold.id, filename: gold.quotation.filename, format: gold.format, contentHash: gold.sha256, sources: gold.quotation.sources, manifest: gold.quotation.manifest };
    expect(scoreExtraction(gold, actual, parsed).criticalFieldAccuracy.numerator).toBe(0);
    actual.items[0].unitPrice = field("12.3");
    expect(scoreExtraction(gold, actual, parsed).criticalFieldAccuracy.numerator).toBe(1);
  });
  it("a missing line reduces recall and all of its stated field scores", async () => {
    const gold = (await manifest()).documents[0], actual = structuredClone(gold.quotation);
    actual.items.pop();
    const parsed = { documentId: gold.id, filename: gold.quotation.filename, format: gold.format, contentHash: gold.sha256, sources: gold.quotation.sources, manifest: gold.quotation.manifest };
    const score = scoreExtraction(gold, actual, parsed);
    expect(score.lineItemRecall).toEqual({ numerator: 5, denominator: 6, value: 5 / 6 });
    expect(score.statedFieldAccuracy.numerator).toBeLessThan(score.statedFieldAccuracy.denominator);
  });
  it("requires explicit live split and fails closed before provider calls when configuration is absent", async () => {
    expect(parseOptions([])).toEqual({ live: false, split: "all", allowPosthoc: false, waitQuota: false });
    expect(() => parseOptions(["--live"])).toThrow("explicit --split");
    expect(parseOptions(["--live", "--split", "dev", "--wait-quota", "--max-new-requests", "1"])).toMatchObject({ waitQuota: true, maxNewRequests: 1 });
    expect(parseOptions(["--live", "--split", "dev", "--document", "industrial-1"])).toMatchObject({ documentId: "industrial-1" });
    expect(() => parseOptions(["--live", "--split", "heldout", "--document", "laboratory-1"])).toThrow("held-out selection is prohibited");
    expect(() => parseOptions(["--split", "dev", "--document"])).toThrow("requires one document ID");
    expect(() => parseOptions(["--live", "--split", "dev", "--max-new-requests", "0"])).toThrow("integer");
    vi.stubEnv("FIELDOPS_PROCESSING_MODE", "ai"); vi.stubEnv("GROQ_API_KEY", "");
    await expect(evaluate({ live: true, split: "dev" })).rejects.toThrow("GROQ_API_KEY");
  });
  it("failed extraction earns no missing-state credit and remains in aggregate recall denominators", async () => {
    const gold = (await manifest()).documents[0], failed = scoreFailedExtraction(gold);
    expect(failed.statedFieldAccuracy.numerator).toBe(0);
    expect(failed.annotatedMissingStateAccuracy.numerator).toBe(0);
    expect(failed.lineItemRecall).toEqual({ numerator: 0, denominator: 6, value: 0 });
    const actual = structuredClone(gold.quotation), parsed = { documentId: gold.id, filename: gold.path, format: gold.format, contentHash: gold.sha256, sources: actual.sources, manifest: actual.manifest };
    const summary = aggregateExtractionMetrics([scoreExtraction(gold, actual, parsed), failed]);
    expect(summary.lineItemRecall).toEqual({ numerator: 6, denominator: 12, value: 0.5 });
  });
  it("scores annotated item ambiguity after mapping model IDs to gold IDs", async () => {
    const gold = (await manifest()).documents[0], actual = structuredClone(gold.quotation);
    const goldId = gold.quotation.items[0].id;
    gold.ambiguities = [`items.${goldId}.quantity`];
    gold.fields = [{ path: `items.${goldId}.quantity`, value: null, state: "ambiguous", critical: true, sourceKey: "line-1" }];
    actual.items[0].id = "model-generated-item-id";
    actual.items[0].quantity = { ...actual.items[0].quantity, state: "ambiguous", value: null };
    const parsed = { documentId: gold.id, filename: gold.path, format: gold.format, contentHash: gold.sha256, sources: actual.sources, manifest: actual.manifest };
    expect(scoreExtraction(gold, actual, parsed).annotatedReviewSignalRecall).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });
});
