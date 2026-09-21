import { describe, expect, it } from "vitest";
import { assertRejectionAuditReport, diagnoseRejectedRecord, sanitizeSchemaIssues } from "../scripts/audit-development-rejections";

const attributes = () => ({ decimal: [], text: [] });
const wire = () => ({ supplier: [], quotation: { numeric: [], text: [] }, terms: [], attributes: attributes(), items: [], charges: [], excluded: [{ sourceIds: ["s0"], disposition: "header", reason: "SYNTHETIC PRIVATE REASON" }], uncertainties: [] });
const rejected = (data: unknown, finishReason = "stop") => ({ code: "invalid_output", cached: false, result: { data, finishReason, rejectedAt: "transport", usageAvailable: false } });
describe("offline saved-rejection diagnostics", () => {
  it("separates malformed generated JSON from provider rejection with a locally valid wire shape", () => {
    const malformed = diagnoseRejectedRecord(rejected('{"PRIVATE UNFINISHED', "provider_schema_rejected"), ["s0"], ["s0"]);
    expect(malformed.stage).toBe("provider_schema_rejected"); expect(malformed.outcome).toBe("malformed_json"); expect(JSON.stringify(malformed)).not.toContain("PRIVATE");
    const valid = diagnoseRejectedRecord(rejected(JSON.stringify(wire()), "provider_schema_rejected"), ["s0"], ["s0"]);
    expect(valid.outcome).toBe("wire_schema_valid_cause_unavailable"); expect(valid.issues).toEqual([]);
  });
  it("reports decimal-format violations without the rejected value or its source alias", () => {
    const data = wire(); (data.quotation.numeric as unknown[]).push({ key: "statedTotal", state: "value", value: "SECRET 1,234 units", raw: "SECRET QUOTATION", sourceIds: ["s0"] });
    const result = diagnoseRejectedRecord(rejected(data), ["s0"], ["s0"]);
    expect(result.outcome).toBe("wire_schema_invalid"); expect(result.issues).toContainEqual({ code: "invalid_format", path: "/quotation/numeric/0/value" });
    const serialized = JSON.stringify(result); expect(serialized).not.toContain("SECRET"); expect(serialized).not.toContain("s0");
  });
  it("reveals known extra structural key names and redacts arbitrary unknown names", () => {
    const data = wire() as ReturnType<typeof wire> & Record<string, unknown>; data.type = "PRIVATE TYPE VALUE"; data["private-supplier-identifier"] = "private";
    const result = diagnoseRejectedRecord(rejected(data), ["s0"], ["s0"]);
    expect(result.issues).toContainEqual({ code: "unrecognized_keys", path: "", unknownKeys: ["type", "[redacted]"] });
    expect(JSON.stringify(result)).not.toContain("private"); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("keeps citation failures structural and refuses to infer wire errors from expanded domain data", () => {
    const data = wire(); data.excluded[0].sourceIds = ["PRIVATE-CITATION"];
    const result = diagnoseRejectedRecord(rejected(data), ["s0"], ["s0"]);
    expect(result.issues).toContainEqual({ code: "invalid_value", path: "/excluded/0/sourceIds/0" }); expect(JSON.stringify(result)).not.toContain("PRIVATE-CITATION");
    const domain = diagnoseRejectedRecord({ code: "invalid_evidence", result: { data: { coverage: [], PRIVATE: "expanded" }, usageAvailable: true } }, ["s0"], ["s0"]);
    expect(domain).toMatchObject({ stage: "domain", outcome: "stage_cause_unavailable", recordedErrorCode: "invalid_evidence", issues: [] });
  });
  it("bounds and sanitizes nested diagnostic paths and keys without retaining Zod messages", () => {
    const issues = sanitizeSchemaIssues([{ code: "invalid_union", path: ["PRIVATE-PATH"], message: "PRIVATE MESSAGE", errors: [[{ code: "unrecognized_keys", path: ["items", 100000000000], keys: ["type", "PRIVATE KEY"] }]] }]);
    expect(issues).toEqual([{ code: "invalid_union", path: "/[redacted]" }, { code: "unrecognized_keys", path: "/items/[redacted]", unknownKeys: ["type", "[redacted]"] }]);
    expect(sanitizeSchemaIssues(Array(200).fill({ code: "custom", path: [] }))).toHaveLength(100);
  });
  it("fails closed on incomplete, non-development, changed or wrong-transport report metadata", () => {
    const report = { name: "synthetic-audit", phase: "after", mode: "live", configurationStableDuringRun: true, configuration: { extractionTransport: "typed_fields_v2", chunkFailurePolicy: "retain_valid_chunks_v1" }, dataset: { split: "dev", requestedDocuments: 3, heldoutDocumentsRead: 0, heldoutModelCalls: 0 }, pair: { selection: ["industrial-1", "translation-2", "office-2"].map(id => ({ id })) } };
    expect(() => assertRejectionAuditReport(report, report.name)).not.toThrow();
    expect(() => assertRejectionAuditReport({ ...report, configurationStableDuringRun: false }, report.name)).toThrow();
    expect(() => assertRejectionAuditReport({ ...report, dataset: { ...report.dataset, split: "not-dev" } }, report.name)).toThrow();
    expect(() => assertRejectionAuditReport({ ...report, configuration: { ...report.configuration, extractionTransport: "legacy_v5" } }, report.name)).toThrow();
    expect(() => assertRejectionAuditReport(null, report.name)).toThrow();
  });
});
