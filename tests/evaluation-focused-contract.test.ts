import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { auditBillingAssertions, assertContractAuditSource, diagnoseFocusedContractRecord } from "../scripts/audit-focused-contract";
import { focusedContractWireSchema } from "../src/lib/ai/focused-contract";
import { emptyItem, emptyQuotation, field } from "../src/lib/domain/types";
import { sectionFieldKeys } from "../src/lib/ai/schema";
import { MODEL_STUDY_METRIC_VERSION } from "../eval/model-study-control";
import { parseDevelopmentOptions } from "../eval/development-control";
import type { FixtureRecord } from "../scripts/generate-fixtures";

const absent = () => ({ state: "not_stated", value: null, raw: null, sourceIds: [] });
const stated = (value: string) => ({ state: "value", value, raw: value, sourceIds: ["s0"] });
const descriptor = { kind: "items" as const, targetIds: ["s0"], contextIds: [], slots: [{ id: "i1", sourceIds: ["s0"] }], structuralHeaderIds: [] };
function legacy(fields: unknown[] = []) {
  return { items: { i1: { ...Object.fromEntries(["description", "identifier", "quantity", "unit", "unitPrice", "lineAmount", "currency"].map(key => [key, absent()])), fields, attributes: [], kind: "unknown", taxBasis: "not_stated", tiers: [], discounts: [] } }, uncertainties: [] };
}
function rejected(data: unknown, provider = false) {
  return { code: "invalid_output", cached: false, result: { data: provider ? JSON.stringify(data) : data, finishReason: provider ? "provider_schema_rejected" : "stop", rejectedAt: "transport", usageAvailable: !provider } };
}
function finalized() {
  const identity = { promptVersion: "synthetic", comparisonKind: "model", model: "openai/gpt-oss-120b", extractionTransport: "focused_fields_v1", chunkFailurePolicy: "retain_valid_chunks_v1", maxTransportAttempts: 1, files: [], runtime: { node: "synthetic" } };
  const ids = ["industrial-1", "translation-2", "office-2"];
  return { name: "synthetic-contract", phase: "before", mode: "live", startedAt: "2026-09-23T00:00:00Z", measuredAt: "2026-09-23T00:01:00Z", configurationStableDuringRun: true,
    configuration: { ...identity, sha256: createHash("sha256").update(JSON.stringify(identity)).digest("hex") }, pair: { comparisonKind: "model", metricVersion: MODEL_STUDY_METRIC_VERSION, selection: ids.map(id => ({ id })) },
    dataset: { split: "dev", synthetic: true, requestedDocuments: 3, heldoutDocumentsRead: 0, heldoutModelCalls: 0 }, measurements: ids.map(id => ({ id, status: "partial" })) };
}

describe("offline focused contract diagnostics", () => {
  it("detects an unchanged numeric violation at the candidate field schema without accepting or repairing its old reply", () => {
    const saved = rejected(legacy([{ key: "minimumOrder", ...stated("25 SENSITIVE-UNITS") }])), before = structuredClone(saved);
    const result = diagnoseFocusedContractRecord(saved, descriptor);
    expect(result).toMatchObject({ originalWireValid: true, originalAdapterValid: false, accepted: false, candidateWireCompatibilityMeasured: false, scalarChecks: [{ field: "minimumOrder", numeric: true, valid: false }] });
    expect(saved).toEqual(before); expect(JSON.stringify(result)).not.toContain("SENSITIVE"); expect(JSON.stringify(result)).not.toContain("s0");
  });
  it("reports duplicate known fields independently of scalar correctness", () => {
    const result = diagnoseFocusedContractRecord(rejected(legacy([{ key: "scope", ...stated("first private scope") }, { key: "scope", ...stated("second private scope") }])), descriptor);
    expect(result).toMatchObject({ originalWireValid: true, originalAdapterValid: false, duplicateKnownFields: ["scope"], accepted: false });
    expect(result.scalarChecks.every(check => check.valid)).toBe(true); expect(JSON.stringify(result)).not.toContain("private scope");
  });
  it("never revives a parseable provider failure or treats expanded/truncated data as raw candidate evidence", () => {
    const provider = diagnoseFocusedContractRecord(rejected(legacy(), true), descriptor);
    expect(provider).toMatchObject({ originalDisposition: "provider_schema_rejected", providerFailurePreserved: true, accepted: false });
    for (const result of [{ data: legacy(), finishReason: "stop" }, { data: "PRIVATE TRUNCATED", rejectedAt: "transport", finishReason: "length" }]) {
      expect(diagnoseFocusedContractRecord({ code: "invalid_output", result }, descriptor)).toMatchObject({ diagnostic: "raw_wire_unavailable", scalarChecks: [], accepted: false });
    }
    const malformed = rejected(legacy(), true); malformed.result.data = "PRIVATE MALFORMED JSON";
    expect(diagnoseFocusedContractRecord(malformed, descriptor)).toMatchObject({ diagnostic: "malformed_json", accepted: false });
    expect(() => diagnoseFocusedContractRecord({ code: "quota", result: {} }, descriptor)).toThrow("interpretation rejection");
  });
  it("requires a billing state object but permits truthful absence; this synthetic control is not a recovered response", () => {
    const item = { ...Object.fromEntries(sectionFieldKeys.item.map(key => [key, absent()])), attributes: [], kind: "unknown", taxBasis: "not_stated", tiers: [], discounts: [] };
    const schema = focusedContractWireSchema("items", ["i1"], ["s0"]);
    expect(schema.safeParse({ items: { i1: item }, uncertainties: [] }).success).toBe(true);
    const { billingBasis: _removed, ...missing } = item as typeof item & { billingBasis: unknown }; void _removed;
    expect(schema.safeParse({ items: { i1: missing }, uncertainties: [] }).success).toBe(false);
    expect(schema.safeParse({ items: { i1: { ...item, fields: [] } }, uncertainties: [] }).success).toBe(false);
  });
  it("counts original annotated billing omissions independently of model kind without filling defaults or unavailable outputs", () => {
    const fields = [{ path: "items.expected.billingBasis", state: "value", value: "hourly", critical: true, sourceKey: "synthetic" }] as FixtureRecord["fields"];
    const quotation = emptyQuotation("synthetic", "synthetic.txt"), item = emptyItem("actual"); item.kind = "goods"; quotation.items = [item];
    const before = structuredClone(quotation);
    expect(auditBillingAssertions({ fields }, quotation, { expected: "actual" })).toMatchObject({ expectedStatedBillingAssertions: 1, alignedItems: 1, statedAssertions: 0, correctAssertions: 0 });
    expect(quotation).toEqual(before);
    item.billingBasis = field("hourly", ["evidence"]);
    expect(auditBillingAssertions({ fields }, quotation, { expected: "actual" })).toMatchObject({ statedAssertions: 1, correctAssertions: 1 });
    expect(auditBillingAssertions({ fields }, null, {})).toMatchObject({ expectedStatedBillingAssertions: 1, alignedItems: 0, statedAssertions: 0 });
  });
  it("refuses unfinished, held-out, different-transport or tampered source reports before inspecting private responses", () => {
    const original = finalized(); expect(() => assertContractAuditSource(original, original.name, "before")).not.toThrow();
    for (const value of [{ ...original, measuredAt: undefined }, { ...original, dataset: { ...original.dataset, split: "heldout" } }, { ...original, configuration: { ...original.configuration, extractionTransport: "focused_fields_v2" } }, { ...original, configurationStableDuringRun: false }]) expect(() => assertContractAuditSource(value, original.name, "before")).toThrow();
  });
  it("keeps the historical default and requires an explicit live-development v2 transport selection", () => {
    const base = ["--name", "synthetic-new-contract", "--phase", "after"];
    expect(parseDevelopmentOptions(base).extractionTransport).toBe("legacy_v5");
    expect(() => parseDevelopmentOptions([...base, "--extraction-transport", "focused_fields_v2"])).toThrow();
    expect(parseDevelopmentOptions([...base, "--live", "--extraction-transport", "focused_fields_v2"]).extractionTransport).toBe("focused_fields_v2");
    expect(() => parseDevelopmentOptions([...base, "--live", "--extraction-transport", "focused_fields_v3"])).toThrow();
  });
});
