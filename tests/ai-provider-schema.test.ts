import Ajv from "ajv";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { typedProviderSchema } from "@/lib/ai/provider-schema";
import { typedExtractionWireSchemaForTargets } from "@/lib/ai/typed-transport";

type JsonSchema = Record<string, unknown>;
const object = (value: unknown): value is JsonSchema => !!value && typeof value === "object" && !Array.isArray(value);
function original(schema: z.ZodType): JsonSchema { const value = z.toJSONSchema(schema, { target: "draft-7", reused: "ref" }) as JsonSchema; delete value.$schema; return value; }
function resolve(root: JsonSchema, value: unknown): JsonSchema {
  if (!object(value)) throw new Error("Expected schema object");
  if (typeof value.$ref !== "string") return value;
  expect(value.$ref.startsWith("#/")).toBe(true);
  let node: unknown = root;
  for (const key of value.$ref.slice(2).split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    expect(object(node) && Object.hasOwn(node, key)).toBe(true);
    node = (node as JsonSchema)[key];
  }
  return resolve(root, node);
}
function nullablePrimitiveUnions(root: JsonSchema) {
  const found: JsonSchema[] = [];
  function visit(value: unknown): void {
    if (!object(value) && !Array.isArray(value)) return;
    if (object(value) && Array.isArray(value.anyOf) && value.anyOf.length === 2) {
      const branches = value.anyOf.map(branch => resolve(root, branch));
      if (branches.some(branch => branch.type === "null") && branches.some(branch => ["string", "number", "integer", "boolean"].includes(String(branch.type)))) found.push(value);
    }
    Object.values(value).forEach(visit);
  }
  visit(root); return found;
}
function checkEquivalent(schema: z.ZodType, examples: unknown[]) {
  const before = original(schema), after = typedProviderSchema(schema);
  const validateBefore = new Ajv({ allErrors: true }).compile(before), validateAfter = new Ajv({ allErrors: true }).compile(after);
  for (const value of examples) expect(validateAfter(value), JSON.stringify(value)).toBe(validateBefore(value));
  return { before, after, validateAfter };
}

describe("provider-compatible primitive nullability serialization", () => {
  it("replaces the observed local-ref decimal/null anyOf while retaining exact decimal constraints", () => {
    const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
    const schema = z.object({ quantity: decimal.nullable(), minimumOrder: decimal.nullable() }).strict();
    const { before, after, validateAfter } = checkEquivalent(schema, [
      { quantity: null, minimumOrder: null }, { quantity: "0", minimumOrder: "0.1250" }, { quantity: "2", minimumOrder: "2 each" },
      { quantity: "1,250", minimumOrder: "2" }, { quantity: "1e3", minimumOrder: "2" }, { quantity: 2, minimumOrder: "2" }, { quantity: "2" },
    ]);
    expect(nullablePrimitiveUnions(before).length).toBeGreaterThan(0); expect(nullablePrimitiveUnions(after)).toEqual([]);
    const quantity = resolve(after, (after.properties as JsonSchema).quantity);
    expect(quantity.type).toEqual(["string", "null"]); expect(quantity.pattern).toBe(/^-?\d+(?:\.\d+)?$/.source);
    expect(validateAfter({ quantity: "2", minimumOrder: "2 each" })).toBe(false);
  });

  it("adds null to referenced enums and literal constraints without admitting extra values", () => {
    const alias = z.enum(["s0", "s1"]), literal = z.literal("fixed");
    const schema = z.object({ first: alias.nullable(), second: alias.nullable(), basis: literal.nullable(), repeatedBasis: literal.nullable() }).strict();
    const values = [null, "s0", "s1", "foreign", "null", 0];
    const examples = values.map(first => ({ first, second: null, basis: "fixed", repeatedBasis: null }));
    examples.push({ first: "s0", second: null, basis: "wrong", repeatedBasis: null });
    const { after } = checkEquivalent(schema, examples);
    expect(nullablePrimitiveUnions(after)).toEqual([]);
    expect(resolve(after, (after.properties as JsonSchema).first).enum).toEqual(["s0", "s1", null]);
    expect(resolve(after, (after.properties as JsonSchema).basis)).toMatchObject({ type: ["string", "null"], enum: ["fixed", null] });
  });

  it("preserves string and numeric restrictions and parent annotations", () => {
    const schema = z.object({ code: z.string().min(2).max(4).regex(/^[A-Z]+$/).nullable().describe("Synthetic code"), amount: z.number().min(0).max(10).multipleOf(0.5).nullable(), enabled: z.boolean().nullable() }).strict();
    const { after } = checkEquivalent(schema, [
      { code: null, amount: null, enabled: null }, { code: "AB", amount: 0.5, enabled: false }, { code: "A", amount: 1, enabled: true },
      { code: "ABCDE", amount: 1, enabled: true }, { code: "ab", amount: 1, enabled: true }, { code: "AB", amount: -1, enabled: true },
      { code: "AB", amount: 11, enabled: true }, { code: "AB", amount: 0.3, enabled: true },
    ]);
    expect(resolve(after, (after.properties as JsonSchema).code)).toMatchObject({ description: "Synthetic code", minLength: 2, maxLength: 4, pattern: "^[A-Z]+$" });
    expect(nullablePrimitiveUnions(after)).toEqual([]);
  });

  it("leaves object/null, discriminated object and non-null primitive unions intact", () => {
    const choice = z.union([z.object({ kind: z.literal("goods"), quantity: z.string() }).strict(), z.object({ kind: z.literal("service"), scope: z.string() }).strict()]);
    const schema = z.object({ choice, optionalObject: z.object({ id: z.string() }).strict().nullable(), scalar: z.union([z.string(), z.number()]), three: z.union([z.string(), z.null(), z.boolean()]) }).strict();
    const before = original(schema), after = typedProviderSchema(schema);
    for (const key of ["choice", "optionalObject", "scalar", "three"]) expect((after.properties as JsonSchema)[key]).toEqual((before.properties as JsonSchema)[key]);
  });

  it("keeps the actual typed schema's local references resolvable and every object required/closed", () => {
    const schema = typedExtractionWireSchemaForTargets(["s0", "s1"], ["s0", "s1", "context"]), before = original(schema), after = typedProviderSchema(schema);
    expect(nullablePrimitiveUnions(before).length).toBeGreaterThan(0); expect(nullablePrimitiveUnions(after)).toEqual([]);
    let objects = 0, references = 0;
    function visit(value: unknown): void {
      if (!object(value) && !Array.isArray(value)) return;
      if (object(value)) {
        if (value.$ref) { resolve(after, value); references++; }
        if (value.type === "object") { objects++; expect(value.additionalProperties).toBe(false); expect([...(value.required as string[])].sort()).toEqual(Object.keys(value.properties as JsonSchema).sort()); }
      }
      Object.values(value).forEach(visit);
    }
    visit(after); expect(objects).toBeGreaterThan(8); expect(references).toBeGreaterThan(0);
    const validate = new Ajv({ allErrors: true }).compile(after);
    const field = { key: "minimumOrder", state: "value", value: "2 each", raw: "2 each", sourceIds: ["s0"] };
    const data = { supplier: [], quotation: [], terms: [], attributes: [], items: [{ sourceIds: ["s0"], kind: "goods", fields: [field], attributes: [], taxBasis: "not_stated", tiers: [], discounts: [] }], charges: [], excluded: [], uncertainties: [] };
    expect(validate(data)).toBe(false); expect(schema.safeParse(data).success).toBe(false);
    field.value = "2"; expect(validate(data)).toBe(true); expect(schema.safeParse(data).success).toBe(true);
  });
});
