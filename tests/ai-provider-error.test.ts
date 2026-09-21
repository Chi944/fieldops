import { describe, expect, it } from "vitest";
import { providerSchemaDiagnostic, ProviderSchemaError, type ProviderSchemaDiagnostic } from "@/lib/ai/provider-error";
import { ProcessingError } from "@/lib/processing/errors";

const envelope = (message: unknown) => ({ status: 400, error: { error: { type: "invalid_request_error", param: "response_format", message } } });
describe("safe provider request-schema diagnostics", () => {
  it("extracts the observed nested schema error without retaining arbitrary message or generation data", () => {
    const diagnostic = providerSchemaDiagnostic(envelope(JSON.stringify({ schema_code: "discriminator_multiple_candidates", schema_kind: "anyOf", schema_path: "/definitions/__schema5/items/anyOf", secret: "PRIVATE QUOTATION", failed_generation: "PRIVATE OUTPUT" })));
    expect(diagnostic).toEqual({ status: 400, type: "invalid_request_error", param: "response_format", schemaCode: "discriminator_multiple_candidates", schemaKind: "anyOf", schemaPath: "/definitions/__schema5/items/anyOf" });
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE");
  });
  it("handles the single SDK envelope and labelled text form using the same allowlist", () => {
    const result = providerSchemaDiagnostic({ status: 400, error: { type: "invalid_request_error", param: "response_format", message: "Secret prefix; schema_code=discriminator_multiple_candidates; schema_kind=anyOf; schema_path=/properties/items/items/anyOf/0; private suffix" } });
    expect(result).toMatchObject({ schemaCode: "discriminator_multiple_candidates", schemaKind: "anyOf", schemaPath: "/properties/items/items/anyOf/0" });
    expect(Object.keys(result!)).toEqual(["status", "type", "param", "schemaCode", "schemaKind", "schemaPath"]);
  });
  it("does not misclassify quotation-output validation, quota or unrelated bad requests as request-schema errors", () => {
    expect(providerSchemaDiagnostic({ status: 400, error: { type: "invalid_request_error", param: "response_format", code: "json_validate_failed", failed_generation: "private" } })).toBeNull();
    expect(providerSchemaDiagnostic({ ...envelope("private"), status: 429 })).toBeNull();
    expect(providerSchemaDiagnostic({ status: 400, error: { type: "invalid_request_error", param: "messages", message: "private" } })).toBeNull();
    expect(providerSchemaDiagnostic({ status: 400, error: { type: "other", param: "response_format" } })).toBeNull();
    expect(providerSchemaDiagnostic(null)).toBeNull(); expect(providerSchemaDiagnostic("private body")).toBeNull();
  });
  it("omits unknown codes, arbitrary property names, escaped tokens and excessive pointers", () => {
    for (const pointer of ["/properties/private-customer-value", "/properties/user~1secret", "/../secret", "https://example.com/private", `/definitions/${"a".repeat(300)}`, "/anyOf/123456789", "/items/", Array(30).fill("/items").join("")]) {
      const result = providerSchemaDiagnostic(envelope({ schema_code: "private_error_text", schema_kind: "private_kind", schema_path: pointer }));
      expect(result).toEqual({ status: 400, type: "invalid_request_error", param: "response_format" });
    }
  });
  it("keeps valid structural pointers while refusing to parse oversized raw messages", () => {
    expect(providerSchemaDiagnostic(envelope({ schema_path: "/$defs/__schema17/properties/unitPrice/type", schema_kind: "object" }))).toMatchObject({ schemaPath: "/$defs/__schema17/properties/unitPrice/type", schemaKind: "object" });
    expect(providerSchemaDiagnostic(envelope("x".repeat(17000)))).toEqual({ status: 400, type: "invalid_request_error", param: "response_format" });
  });
  it("exposes a static non-retryable ProcessingError and re-sanitizes constructor input", () => {
    const error = new ProviderSchemaError({ status: 400, type: "invalid_request_error", param: "response_format", schemaCode: "discriminator_multiple_candidates", schemaKind: "anyOf", schemaPath: "/properties/private-value", message: "PRIVATE SECRET", body: "PRIVATE BODY" } as unknown as ProviderSchemaDiagnostic);
    expect(error).toBeInstanceOf(ProcessingError); expect(error.code).toBe("model_error"); expect(error.retryable).toBe(false);
    expect(error.message).toContain("request schema"); expect(error.message).not.toContain("PRIVATE");
    expect(error.diagnostic).toEqual({ status: 400, type: "invalid_request_error", param: "response_format", schemaCode: "discriminator_multiple_candidates", schemaKind: "anyOf" });
    expect(Object.isFrozen(error.diagnostic)).toBe(true); expect(JSON.stringify(error)).not.toContain("PRIVATE");
  });
});
