import { z } from "zod";
import { fieldsSchema, evidenceSchema } from "@/modules/parsing/contracts";
import type { FullRecommendation } from "./service";

export const sourceMessageViewSchema = z.object({
  id: z.string(),
  gmailMessageId: z.string(),
  accountEmail: z.string(),
  gmailThreadId: z.string(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  sentAt: z.string().nullable(),
  contentSha256: z.string(),
  parserVersion: z.string(),
  importStatus: z.string(),
  errorCode: z.string().nullable(),
  warnings: z.array(z.string()),
});
export const recommendationViewSchema = z.object({
  id: z.string(),
  fields: fieldsSchema,
  revision: z.number(),
  reviewStatus: z.enum(["NEEDS_REVIEW", "APPROVED", "REJECTED"]),
  approvedAt: z.string().nullable(),
  availableAt: z.string(),
  confidence: z.number(),
  parserVersion: z.string(),
  warnings: z.array(z.string()),
  manualFields: z.array(z.string()),
  evidence: z.array(evidenceSchema.extend({ id: z.string() })),
  source: sourceMessageViewSchema,
  events: z.array(
    z.object({
      id: z.string(),
      eventType: z.string(),
      effectiveAt: z.string(),
      relatedRecommendationId: z.string().nullable(),
      matchConfidence: z.number(),
      reviewStatus: z.string(),
      previousValuesJson: z.string(),
      newValuesJson: z.string(),
    }),
  ),
  versions: z.array(
    z.object({
      revision: z.number(),
      reason: z.string(),
      snapshotJson: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type RecommendationView = z.infer<typeof recommendationViewSchema>;
export const recommendationListSchema = z.object({
  records: z.array(recommendationViewSchema),
  total: z.number(),
  page: z.number(),
});
export function messageView(source: {
  id: string;
  gmailMessageId: string;
  accountEmail: string;
  gmailThreadId: string;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  sentAt: Date | null;
  contentSha256: string;
  parserVersion: string;
  importStatus: string;
  errorCode: string | null;
  warningsJson: string;
}) {
  return sourceMessageViewSchema.parse({
    ...source,
    receivedAt: source.receivedAt.toISOString(),
    sentAt: source.sentAt?.toISOString() ?? null,
    warnings: JSON.parse(source.warningsJson),
  });
}
export function recommendationView(record: FullRecommendation) {
  return recommendationViewSchema.parse({
    id: record.id,
    fields: fieldsSchema.strip().parse({
      ...record,
      publishedAt: record.publishedAt?.toISOString() ?? null,
      targets: record.targets.map((target) => target.price),
    }),
    revision: record.revision,
    reviewStatus: record.reviewStatus,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    availableAt: record.availableAt.toISOString(),
    confidence: record.extractionConfidence,
    parserVersion: record.parserVersion,
    warnings: JSON.parse(record.warningsJson),
    manualFields: JSON.parse(record.manualFieldsJson),
    evidence: record.evidence.map(
      ({
        id,
        fieldName,
        extractedValue,
        evidenceSnippet,
        confidence,
        extractionMethod,
      }) => ({
        id,
        fieldName,
        extractedValue,
        evidenceSnippet,
        confidence,
        extractionMethod,
      }),
    ),
    source: messageView(record.sourceMessage),
    events: record.events.map((event) => ({
      ...event,
      effectiveAt: event.effectiveAt.toISOString(),
    })),
    versions: record.versions.map((version) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}
