import { z } from "zod";

export const fieldKeys = ["name", "contact", "email", "phone", "address", "quotationNumber", "date", "revision", "currency", "locale", "statedSubtotal", "statedTotal", "validity", "availability", "leadTime", "delivery", "payment", "warranty", "exclusions", "notes", "description", "identifier", "quantity", "unit", "packageSize", "packageUnit", "minimumOrder", "orderIncrement", "unitPrice", "lineAmount", "billingBasis", "duration", "scope", "taxRate", "amount"] as const;
export const extractedFieldSchema = z.object({ key: z.enum(fieldKeys), state: z.enum(["value", "not_stated", "not_applicable", "ambiguous"]), value: z.string().nullable(), raw: z.string().nullable(), sourceIds: z.array(z.string()) }).strict();
const attributeSchema = z.object({ key: z.string(), label: z.string(), type: z.enum(["text", "decimal", "date", "boolean"]), value: z.string().nullable(), state: z.enum(["value", "not_stated", "not_applicable", "ambiguous"]), raw: z.string().nullable(), unit: z.string().nullable(), sourceIds: z.array(z.string()) }).strict();
const tierSchema = z.object({ min: z.string(), max: z.string().nullable(), unitPrice: z.string(), unit: z.string(), basis: z.enum(["all_units", "graduated", "ambiguous"]), sourceIds: z.array(z.string()) }).strict();
const discountSchema = z.object({ kind: z.enum(["percent", "fixed"]), value: z.string(), basis: z.enum(["unit", "line", "order", "ambiguous"]), alreadyIncluded: z.boolean(), sourceIds: z.array(z.string()) }).strict();
export const extractionSchema = z.object({
  supplier: z.array(extractedFieldSchema), quotation: z.array(extractedFieldSchema), terms: z.array(extractedFieldSchema),
  items: z.array(z.object({ sourceIds: z.array(z.string()), kind: z.enum(["goods", "service", "mixed", "unknown"]), fields: z.array(extractedFieldSchema), taxBasis: z.enum(["inclusive", "exclusive", "not_stated"]), tiers: z.array(tierSchema), discount: discountSchema.nullable(), attributes: z.array(attributeSchema) }).strict()),
  charges: z.array(z.object({ label: z.string(), kind: z.enum(["shipping", "tax", "setup", "recurring", "other", "discount"]), fields: z.array(extractedFieldSchema), billingPeriod: z.string().nullable(), appliesTo: z.enum(["quotation", "item", "unknown"]), itemSourceId: z.string().nullable() }).strict()),
  attributes: z.array(attributeSchema),
  coverage: z.array(z.object({ sourceId: z.string(), disposition: z.enum(["used", "header", "continuation", "terms", "non_quotation", "unreadable"]), reason: z.string() }).strict()),
  uncertainties: z.array(z.object({ message: z.string(), sourceIds: z.array(z.string()) }).strict()),
}).strict();
export type ExtractedChunk = z.infer<typeof extractionSchema>;
export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type ExtractedAttribute = z.infer<typeof attributeSchema>;
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const result = z.toJSONSchema(schema, { target: "draft-7", reused: "ref" }) as Record<string, unknown>;
  delete result.$schema;
  return result;
}
