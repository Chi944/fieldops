import { z } from "zod";

export const fieldKeys = ["name", "contact", "email", "phone", "address", "quotationNumber", "date", "revision", "currency", "locale", "statedSubtotal", "statedTotal", "validity", "availability", "leadTime", "delivery", "payment", "warranty", "exclusions", "notes", "description", "identifier", "quantity", "unit", "packageSize", "packageUnit", "minimumOrder", "orderIncrement", "unitPrice", "lineAmount", "billingBasis", "duration", "scope", "taxRate", "amount", "specification", "packageContents"] as const;
export const extractedFieldSchema = z.object({ key: z.enum(fieldKeys), state: z.enum(["value", "not_stated", "not_applicable", "ambiguous"]), value: z.string().nullable(), raw: z.string().nullable(), sourceIds: z.array(z.string()) }).strict();
// Keep constrained decoding and runtime integration on the same section keys.
export const sectionFieldKeys = {
  supplier: ["name", "contact", "email", "phone", "address"],
  quotation: ["quotationNumber", "date", "revision", "currency", "locale", "statedSubtotal", "statedTotal"],
  terms: ["validity", "availability", "leadTime", "delivery", "payment", "warranty", "exclusions", "notes"],
  item: ["description", "identifier", "quantity", "unit", "packageSize", "packageUnit", "minimumOrder", "orderIncrement", "unitPrice", "lineAmount", "currency", "billingBasis", "duration", "scope", "leadTime", "taxRate"],
  charge: ["amount", "currency"],
} as const;
const sectionFields = <const T extends readonly [(typeof fieldKeys)[number], ...(typeof fieldKeys)[number][]]>(keys: T) => z.array(extractedFieldSchema.extend({ key: z.enum(keys) }));
export const itemAttributeFieldKeys = ["specification", "packageContents"] as const;
const attributeSchema = z.object({ key: z.string(), label: z.string(), type: z.enum(["text", "decimal", "date", "boolean"]), value: z.string().nullable(), state: z.enum(["value", "not_stated", "not_applicable", "ambiguous"]), raw: z.string().nullable(), unit: z.string().nullable(), sourceIds: z.array(z.string()) }).strict();
const tierSchema = z.object({ min: z.string(), max: z.string().nullable(), unitPrice: z.string(), unit: z.string(), basis: z.enum(["all_units", "graduated", "ambiguous"]), sourceIds: z.array(z.string()) }).strict();
const discountSchema = z.object({ kind: z.enum(["percent", "fixed"]), value: z.string(), basis: z.enum(["unit", "line", "order", "ambiguous"]), alreadyIncluded: z.boolean(), sourceIds: z.array(z.string()) }).strict();
export const extractionSchema = z.object({
  supplier: sectionFields(sectionFieldKeys.supplier), quotation: sectionFields(sectionFieldKeys.quotation), terms: sectionFields(sectionFieldKeys.terms),
  items: z.array(z.object({ sourceIds: z.array(z.string()), kind: z.enum(["goods", "service", "mixed", "unknown"]), fields: sectionFields([...sectionFieldKeys.item, ...itemAttributeFieldKeys]), taxBasis: z.enum(["inclusive", "exclusive", "not_stated"]), tiers: z.array(tierSchema), discount: discountSchema.nullable(), attributes: z.array(attributeSchema) }).strict()),
  charges: z.array(z.object({ label: z.string(), kind: z.enum(["shipping", "tax", "setup", "recurring", "other", "discount"]), fields: sectionFields(sectionFieldKeys.charge), billingPeriod: z.string().nullable(), appliesTo: z.enum(["quotation", "item", "unknown"]), itemSourceId: z.string().nullable() }).strict()),
  attributes: z.array(attributeSchema),
  coverage: z.array(z.object({ sourceId: z.string(), disposition: z.enum(["used", "header", "continuation", "terms", "non_quotation", "unreadable"]), reason: z.string() }).strict()),
  uncertainties: z.array(z.object({ message: z.string(), sourceIds: z.array(z.string()) }).strict()),
}).strict();
export type ExtractedChunk = z.infer<typeof extractionSchema>;
export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type ExtractedAttribute = z.infer<typeof attributeSchema>;
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const result = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete result.$schema;
  return result;
}
