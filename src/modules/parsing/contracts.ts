import { z } from "zod";

export const PARSER_VERSION = "axis-rules/1.0.0";
export const lifecycle = z.enum([
  "NEW",
  "REITERATED",
  "TARGET_REVISED",
  "STOP_REVISED",
  "UPGRADED",
  "DOWNGRADED",
  "CLOSED",
  "WITHDRAWN",
  "TARGET_ACHIEVED",
  "UNKNOWN_UPDATE",
]);
const price = z.number().finite().positive().max(1e10).nullable();
export const fieldsSchema = z
  .object({
    provider: z.string().min(1).max(100),
    category: z.string().max(160).nullable(),
    reportReference: z.string().max(100).nullable(),
    publishedAt: z.iso.datetime().nullable(),
    companyName: z.string().max(160).nullable(),
    symbol: z
      .string()
      .regex(/^[A-Za-z0-9&.-]{1,30}$/)
      .nullable(),
    bseCode: z
      .string()
      .regex(/^\d{6}$/)
      .nullable(),
    action: z.enum(["BUY", "HOLD", "SELL", "ACCUMULATE", "REDUCE"]).nullable(),
    recommendedPrice: price,
    entryLow: price,
    entryHigh: price,
    targets: z.array(z.number().finite().positive().max(1e10)).max(12),
    stopLoss: price,
    statedUpsidePercent: z.number().finite().min(-100).max(10000).nullable(),
    horizon: z.string().max(100).nullable(),
    rationale: z.string().max(240).nullable(),
    status: lifecycle,
  })
  .strict();
export type RecommendationFields = z.infer<typeof fieldsSchema>;
export const evidenceSchema = z
  .object({
    fieldName: z.string(),
    extractedValue: z.string().max(1000),
    evidenceSnippet: z.string().max(240),
    confidence: z.number().min(0).max(1),
    extractionMethod: z.enum(["DETERMINISTIC", "DERIVED", "MANUAL"]),
  })
  .strict();
export const extractionSchema = z
  .object({
    fields: fieldsSchema,
    evidence: z.array(evidenceSchema),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string().max(200)),
    parserVersion: z.string(),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;

export function fieldWarnings(fields: RecommendationFields) {
  const warnings: string[] = [];
  if (!fields.companyName && !fields.symbol && !fields.bseCode)
    warnings.push("MISSING_INSTRUMENT");
  if (fields.symbol || fields.bseCode)
    warnings.push("INSTRUMENT_UNVERIFIED_PHASE_2");
  if (!fields.stopLoss) warnings.push("MISSING_STOP_LOSS");
  if (!fields.targets.length) warnings.push("MISSING_TARGET");
  if (!fields.recommendedPrice && !fields.entryLow)
    warnings.push("MISSING_ENTRY");
  if (fields.entryLow && fields.entryHigh && fields.entryLow > fields.entryHigh)
    warnings.push("INVALID_ENTRY_RANGE");
  return warnings;
}
