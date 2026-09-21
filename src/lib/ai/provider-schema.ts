import { z } from "zod";

type JsonSchema = Record<string, unknown>;
const object = (value: unknown): value is JsonSchema => !!value && typeof value === "object" && !Array.isArray(value);
const annotations = new Set(["title", "description", "default", "examples", "$comment", "deprecated", "readOnly", "writeOnly"]);
const primitiveConstraints = new Set([
  "type", "enum", "const", "minLength", "maxLength", "pattern", "format", "contentEncoding", "contentMediaType",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
]);
const schemaMaps = new Set(["properties", "patternProperties", "definitions", "$defs", "dependentSchemas"]);
const schemaArrays = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const schemaValues = new Set([
  "items", "additionalProperties", "additionalItems", "contains", "not", "if", "then", "else", "propertyNames",
  "unevaluatedProperties", "unevaluatedItems",
]);

function localDefinition(root: JsonSchema, value: unknown, seen = new Set<string>()): JsonSchema | undefined {
  if (!object(value)) return undefined;
  if (!Object.hasOwn(value, "$ref")) return value;
  // A reference with siblings can add constraints; do not discard those constraints.
  if (Object.keys(value).length !== 1 || typeof value.$ref !== "string" || !value.$ref.startsWith("#/") || seen.has(value.$ref)) return undefined;
  seen.add(value.$ref);
  let definition: unknown = root;
  for (const key of value.$ref.slice(2).split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!object(definition) || !Object.hasOwn(definition, key)) return undefined;
    definition = definition[key];
  }
  return localDefinition(root, definition, seen);
}

function primitiveNullable(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2 || Object.keys(schema).some(key => key !== "anyOf" && !annotations.has(key))) return schema;
  const branches = schema.anyOf.map(branch => localDefinition(root, branch));
  const nullBranch = branches.find(branch => branch?.type === "null");
  const primitive = branches.find(branch => typeof branch?.type === "string" && ["string", "number", "integer", "boolean"].includes(branch.type));
  if (!nullBranch || !primitive || Object.keys(nullBranch).some(key => key !== "type" && !annotations.has(key)) ||
      Object.keys(primitive).some(key => !primitiveConstraints.has(key) && !annotations.has(key))) return schema;

  // Type-specific constraints (including the canonical decimal pattern) remain in place.
  // Object/composite unions never enter this branch.
  const result: JsonSchema = { ...primitive, type: [primitive.type, "null"] };
  if (Object.hasOwn(primitive, "const")) {
    const permitted = !Array.isArray(primitive.enum) || primitive.enum.includes(primitive.const);
    result.enum = permitted && primitive.const !== null ? [primitive.const, null] : [null];
    delete result.const;
  } else if (Array.isArray(primitive.enum)) {
    result.enum = primitive.enum.includes(null) ? [...primitive.enum] : [...primitive.enum, null];
  }
  for (const key of annotations) if (Object.hasOwn(schema, key)) result[key] = schema[key];
  return result;
}

export function typedProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const root = z.toJSONSchema(schema, { target: "draft-7", reused: "ref" }) as JsonSchema;
  delete root.$schema;
  function normalize(value: unknown): unknown {
    if (!object(value)) return value;
    const result = primitiveNullable({ ...value }, root);
    for (const [key, child] of Object.entries(result)) {
      if (schemaMaps.has(key) && object(child)) result[key] = Object.fromEntries(Object.entries(child).map(([name, entry]) => [name, normalize(entry)]));
      else if (schemaArrays.has(key) && Array.isArray(child)) result[key] = child.map(normalize);
      else if (schemaValues.has(key)) result[key] = Array.isArray(child) ? child.map(normalize) : normalize(child);
    }
    return result;
  }
  return normalize(root) as JsonSchema;
}
