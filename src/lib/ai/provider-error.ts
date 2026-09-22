import { ProcessingError } from "../processing/errors";

const schemaCodes = ["discriminator_multiple_candidates"] as const;
const schemaKinds = ["anyOf", "oneOf", "allOf", "object", "array", "string", "number", "integer", "boolean", "null", "$ref"] as const;
type SchemaCode = typeof schemaCodes[number];
type SchemaKind = typeof schemaKinds[number];
export interface ProviderSchemaDiagnostic {
  status: 400;
  type: "invalid_request_error";
  param: "response_format";
  schemaCode?: SchemaCode;
  schemaKind?: SchemaKind;
  schemaPath?: string;
}
const pointerSegments = new Set([
  "$defs", "definitions", "properties", "items", "prefixItems", "additionalProperties", "anyOf", "oneOf", "allOf", "not", "if", "then", "else", "required", "enum", "const", "type", "$ref",
  "numeric", "text", "decimal", "excluded", "discounts",
  // Static application schema property names, never source values or arbitrary
  // custom attribute keys. Unknown property names are omitted from diagnostics.
  "supplier", "quotation", "terms", "charges", "attributes", "coverage", "uncertainties", "name", "contact", "email", "phone", "address", "quotationNumber", "date", "revision", "currency", "locale", "statedSubtotal", "statedTotal",
  "id", "kind", "fields", "description", "identifier", "quantity", "unit", "unitPrice", "lineAmount", "sourceIds", "sourceId", "raw", "state", "value", "label", "min", "max", "basis", "taxRate", "taxBasis", "discount", "tiers", "billingBasis", "scope", "duration", "key", "packageSize", "packageUnit", "minimumOrder", "orderIncrement", "leadTime", "appliesTo", "amount", "alreadyIncluded", "billingPeriod", "itemSourceId", "disposition", "reason", "message",
]);
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function constrainedPointer(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256) return undefined;
  if (value === "") return value;
  if (!value.startsWith("/")) return undefined;
  const parts = value.slice(1).split("/");
  return parts.length <= 24 && parts.every(part => pointerSegments.has(part) || /^__schema\d{1,4}$/.test(part) || /^(?:0|[1-9]\d{0,2})$/.test(part)) ? value : undefined;
}
function safeDetails(value: Record<string, unknown>) {
  const code = value.schema_code ?? value.schemaCode, kind = value.schema_kind ?? value.schemaKind;
  const pointer = constrainedPointer(value.schema_path ?? value.schemaPath);
  return {
    ...(schemaCodes.includes(code as SchemaCode) ? { schemaCode: code as SchemaCode } : {}),
    ...(schemaKinds.includes(kind as SchemaKind) ? { schemaKind: kind as SchemaKind } : {}),
    ...(pointer !== undefined ? { schemaPath: pointer } : {}),
  };
}
function messageDetails(message: unknown): Record<string, unknown> {
  const object = record(message);
  if (object) return object;
  if (typeof message !== "string" || message.length > 16384) return {};
  try { const decoded = record(JSON.parse(message)); if (decoded) return decoded; } catch { /* Some provider diagnostics use labelled text rather than JSON. */ }
  const details: Record<string, unknown> = {};
  for (const key of ["schema_code", "schema_kind", "schema_path"]) {
    const match = new RegExp(`\\b${key}["']?\\s*[:=]\\s*["']?([^\\s,"'{};]+)`).exec(message);
    if (match) details[key] = match[1];
  }
  return details;
}

/** Recognizes a request-schema rejection, not rejected generated content.
 * Raw provider messages, body, generation, document text and unknown values are
 * deliberately excluded. Returning null means the caller uses its usual error.
 */
export function providerSchemaDiagnostic(error: unknown): ProviderSchemaDiagnostic | null {
  try {
    const root = record(error);
    if (root?.status !== 400) return null;
    const envelope = record(root.error) ?? root;
    const validation = record(envelope.error) ?? envelope;
    if (validation.type !== "invalid_request_error" || validation.param !== "response_format" || validation.code === "json_validate_failed") return null;
    return { status: 400, type: "invalid_request_error", param: "response_format", ...safeDetails(validation), ...safeDetails(messageDetails(validation.message)) };
  } catch { return null; }
}

/** Static user-facing failure; diagnostic values remain safe for operation logs. */
export class ProviderSchemaError extends ProcessingError {
  readonly diagnostic: Readonly<ProviderSchemaDiagnostic>;
  constructor(diagnostic: ProviderSchemaDiagnostic) {
    super("model_error", "The provider rejected the application's structured-output request schema. Check the model configuration before retrying. No quotation interpretation was accepted.");
    this.name = "ProviderSchemaError";
    // Rebuild even typed input so runtime callers cannot smuggle extra fields or
    // unconstrained pointers into a supposedly safe diagnostic object.
    this.diagnostic = Object.freeze({ status: 400, type: "invalid_request_error", param: "response_format", ...safeDetails(record(diagnostic) ?? {}) });
  }
}
