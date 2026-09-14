import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db } from "@/modules/security/db";
import { AppError } from "@/modules/security/errors";
import {
  fieldsSchema,
  fieldWarnings,
  type Extraction,
  type RecommendationFields,
} from "@/modules/parsing/contracts";

export const includeRecommendation = {
  targets: { orderBy: { sequence: "asc" as const } },
  evidence: true,
  events: true,
  versions: { orderBy: { revision: "desc" as const } },
  sourceMessage: true,
};
export type FullRecommendation = Prisma.RecommendationGetPayload<{
  include: typeof includeRecommendation;
}>;
export function recommendationFields(
  record: FullRecommendation,
): RecommendationFields {
  return fieldsSchema.parse({
    provider: record.provider,
    category: record.category,
    reportReference: record.reportReference,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    companyName: record.companyName,
    symbol: record.symbol,
    bseCode: record.bseCode,
    action: record.action,
    recommendedPrice: record.recommendedPrice,
    entryLow: record.entryLow,
    entryHigh: record.entryHigh,
    targets: record.targets.map((target) => target.price),
    stopLoss: record.stopLoss,
    statedUpsidePercent: record.statedUpsidePercent,
    horizon: record.horizon,
    rationale: record.rationale,
    status: record.status,
  });
}

export function fieldsData(fields: RecommendationFields) {
  const { targets, publishedAt, ...scalar } = fields;
  return {
    ...scalar,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    primaryTarget: targets[0] ?? null,
  };
}

export async function getRecommendation(id: string, database = db) {
  const record = await database.recommendation.findUnique({
    where: { id },
    include: includeRecommendation,
  });
  if (!record) throw new AppError("RECOMMENDATION_NOT_FOUND", 404);
  return record;
}

export const correctionSchema = z
  .object({
    revision: z.number().int().positive(),
    fields: fieldsSchema,
    reason: z.string().trim().min(3).max(200),
    relatedRecommendationId: z.string().max(100).nullable().optional(),
  })
  .strict();
export const decisionSchema = z
  .object({
    revision: z.number().int().positive(),
    acknowledgeWarnings: z.boolean().default(false),
  })
  .strict();

async function version(
  tx: Prisma.TransactionClient,
  id: string,
  reason: string,
) {
  const record = await tx.recommendation.findUniqueOrThrow({
    where: { id },
    include: includeRecommendation,
  });
  const { versions: _versions, sourceMessage: _source, ...snapshot } = record;
  void _versions;
  void _source;
  await tx.recommendationVersion.create({
    data: {
      recommendationId: id,
      revision: record.revision,
      reason,
      snapshotJson: JSON.stringify(snapshot),
    },
  });
}

export async function correctRecommendation(
  id: string,
  input: z.infer<typeof correctionSchema>,
  database = db,
) {
  return database.$transaction(async (tx) => {
    const record = await tx.recommendation.findUnique({
      where: { id },
      include: includeRecommendation,
    });
    if (!record) throw new AppError("RECOMMENDATION_NOT_FOUND", 404);
    const before = recommendationFields(record);
    const changed = (
      Object.keys(input.fields) as (keyof RecommendationFields)[]
    ).filter(
      (key) =>
        JSON.stringify(before[key]) !== JSON.stringify(input.fields[key]),
    );
    const manualFields = [
      ...new Set([
        ...z.array(z.string()).parse(JSON.parse(record.manualFieldsJson)),
        ...changed,
      ]),
    ];
    if (input.relatedRecommendationId) {
      const related = await tx.recommendation.findUnique({
        where: { id: input.relatedRecommendationId },
        include: { sourceMessage: true },
      });
      if (
        !related ||
        related.id === id ||
        related.availableAt >= record.availableAt ||
        related.sourceMessage.accountEmail !== record.sourceMessage.accountEmail
      )
        throw new AppError("INVALID_EARLIER_RECOMMENDATION");
    }
    const result = await tx.recommendation.updateMany({
      where: { id, revision: input.revision },
      data: {
        ...fieldsData(input.fields),
        manualFieldsJson: JSON.stringify(manualFields),
        warningsJson: JSON.stringify([
          ...new Set([
            ...z
              .array(z.string())
              .parse(JSON.parse(record.warningsJson))
              .filter(
                (warning) =>
                  ![
                    "MISSING_INSTRUMENT",
                    "MISSING_STOP_LOSS",
                    "MISSING_TARGET",
                    "MISSING_ENTRY",
                    "INVALID_ENTRY_RANGE",
                    "INSTRUMENT_UNVERIFIED_PHASE_2",
                  ].includes(warning),
              ),
            ...fieldWarnings(input.fields),
          ]),
        ]),
        reviewStatus: "NEEDS_REVIEW",
        approvedAt: null,
        revision: { increment: 1 },
      },
    });
    if (!result.count) throw new AppError("REVISION_CONFLICT_RELOAD", 409);
    if (changed.includes("targets")) {
      await tx.recommendationTarget.deleteMany({
        where: { recommendationId: id },
      });
      await tx.recommendationTarget.createMany({
        data: input.fields.targets.map((price, sequence) => ({
          recommendationId: id,
          price,
          sequence: sequence + 1,
        })),
      });
    }
    for (const key of changed)
      await tx.fieldEvidence.create({
        data: {
          recommendationId: id,
          fieldName: key,
          extractedValue: JSON.stringify(input.fields[key]),
          evidenceSnippet: input.reason,
          confidence: 1,
          extractionMethod: "MANUAL",
        },
      });
    await tx.recommendationEvent.updateMany({
      where: { recommendationId: id },
      data: {
        eventType: input.fields.status,
        newValuesJson: JSON.stringify(input.fields),
        reviewStatus: "NEEDS_REVIEW",
        ...(input.relatedRecommendationId !== undefined
          ? {
              relatedRecommendationId: input.relatedRecommendationId,
              matchConfidence: input.relatedRecommendationId ? 1 : 0,
            }
          : {}),
      },
    });
    await version(tx, id, input.reason);
    await tx.auditLog.create({
      data: { action: "RECOMMENDATION_CORRECTED", entityId: id },
    });
    return id;
  });
}

export async function decideRecommendation(
  id: string,
  decision: "APPROVED" | "REJECTED",
  input: z.infer<typeof decisionSchema>,
  database = db,
) {
  await database.$transaction(async (tx) => {
    const record = await tx.recommendation.findUnique({
      where: { id },
      include: includeRecommendation,
    });
    if (!record) throw new AppError("RECOMMENDATION_NOT_FOUND", 404);
    const warnings = z.array(z.string()).parse(JSON.parse(record.warningsJson));
    if (decision === "APPROVED") {
      if (!record.companyName && !record.symbol && !record.bseCode)
        throw new AppError("INSTRUMENT_REQUIRED");
      if (
        record.entryLow &&
        record.entryHigh &&
        record.entryLow > record.entryHigh
      )
        throw new AppError("INVALID_ENTRY_RANGE");
      if (warnings.length && !input.acknowledgeWarnings)
        throw new AppError("ACKNOWLEDGE_DATA_WARNINGS");
    }
    const updated = await tx.recommendation.updateMany({
      where: { id, revision: input.revision },
      data: {
        reviewStatus: decision,
        approvedAt: decision === "APPROVED" ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    if (!updated.count) throw new AppError("REVISION_CONFLICT_RELOAD", 409);
    await tx.recommendationEvent.updateMany({
      where: { recommendationId: id },
      data: { reviewStatus: decision },
    });
    await version(tx, id, decision);
    await tx.auditLog.create({
      data: { action: `RECOMMENDATION_${decision}`, entityId: id },
    });
  });
  return id;
}

export async function persistExtraction(
  tx: Prisma.TransactionClient,
  sourceMessageId: string,
  receivedAt: Date,
  ordinal: number,
  extraction: Extraction,
  existing?: FullRecommendation,
) {
  if (existing) {
    const original = recommendationFields(existing);
    const protectedFields =
      existing.reviewStatus === "APPROVED"
        ? Object.keys(original)
        : z.array(z.string()).parse(JSON.parse(existing.manualFieldsJson));
    const merged = { ...extraction.fields };
    for (const key of protectedFields)
      Object.assign(merged, {
        [key]: original[key as keyof RecommendationFields],
      });
    const fields = fieldsSchema.parse(merged);
    await tx.recommendation.update({
      where: { id: existing.id },
      data: {
        ...fieldsData(fields),
        parserVersion: extraction.parserVersion,
        extractionConfidence: extraction.confidence,
        warningsJson: JSON.stringify([
          ...new Set([...extraction.warnings, ...fieldWarnings(fields)]),
        ]),
        revision: { increment: 1 },
        targets: {
          deleteMany: {},
          create: fields.targets.map((price, sequence) => ({
            price,
            sequence: sequence + 1,
          })),
        },
        evidence: { create: extraction.evidence },
      },
    });
    await tx.recommendationEvent.updateMany({
      where: { recommendationId: existing.id },
      data: { eventType: fields.status, newValuesJson: JSON.stringify(fields) },
    });
    await version(tx, existing.id, "REPARSED_MANUAL_FIELDS_PRESERVED");
    return existing.id;
  }
  const fields = extraction.fields;
  const record = await tx.recommendation.create({
    data: {
      ...fieldsData(fields),
      sourceMessageId,
      ordinal,
      availableAt: receivedAt,
      parserVersion: extraction.parserVersion,
      extractionConfidence: extraction.confidence,
      warningsJson: JSON.stringify(extraction.warnings),
      manualFieldsJson: JSON.stringify(
        extraction.evidence.length &&
          extraction.evidence.every(
            (item) => item.extractionMethod === "MANUAL",
          )
          ? Object.keys(fields)
          : [],
      ),
      targets: {
        create: fields.targets.map((price, sequence) => ({
          price,
          sequence: sequence + 1,
        })),
      },
      evidence: { create: extraction.evidence },
    },
  });
  const source = await tx.sourceMessage.findUniqueOrThrow({
    where: { id: sourceMessageId },
  });
  let candidates: { id: string }[] = [];
  let confidence = 0;
  if (fields.status !== "NEW") {
    const base: Prisma.RecommendationWhereInput = {
      availableAt: { lt: receivedAt },
      provider: fields.provider,
      sourceMessage: { accountEmail: source.accountEmail },
    };
    const strategies: {
      where: Prisma.RecommendationWhereInput;
      confidence: number;
    }[] = [
      ...(fields.reportReference
        ? [
            {
              where: { ...base, reportReference: fields.reportReference },
              confidence: 0.98,
            },
          ]
        : []),
      {
        where: {
          ...base,
          ...(fields.symbol
            ? { symbol: fields.symbol }
            : { companyName: fields.companyName }),
          sourceMessage: {
            accountEmail: source.accountEmail,
            gmailThreadId: source.gmailThreadId,
          },
        },
        confidence: 0.9,
      },
      ...(fields.symbol && fields.category
        ? [
            {
              where: {
                ...base,
                symbol: fields.symbol,
                category: fields.category,
              },
              confidence: 0.7,
            },
          ]
        : []),
      ...(fields.symbol
        ? [
            {
              where: {
                ...base,
                symbol: fields.symbol,
                status: { notIn: ["CLOSED", "WITHDRAWN", "TARGET_ACHIEVED"] },
                availableAt: {
                  lt: receivedAt,
                  gte: new Date(
                    receivedAt.getTime() -
                      Number(process.env.UPDATE_MATCH_WINDOW_DAYS ?? 90) *
                        86400000,
                  ),
                },
              },
              confidence: 0.5,
            },
          ]
        : []),
    ];
    for (const strategy of strategies) {
      candidates = await tx.recommendation.findMany({
        where: strategy.where,
        orderBy: { availableAt: "desc" },
        take: 2,
        select: { id: true },
      });
      if (candidates.length) {
        confidence = candidates.length === 1 ? strategy.confidence : 0;
        break;
      }
    }
  }
  const relatedId = candidates.length === 1 ? candidates[0].id : null;
  const previous = relatedId
    ? await tx.recommendation.findUniqueOrThrow({
        where: { id: relatedId },
        include: includeRecommendation,
      })
    : null;
  await tx.recommendationEvent.create({
    data: {
      recommendationId: record.id,
      sourceMessageId,
      eventType: fields.status,
      effectiveAt: receivedAt,
      relatedRecommendationId: relatedId,
      previousValuesJson: previous
        ? JSON.stringify(recommendationFields(previous))
        : "{}",
      newValuesJson: JSON.stringify(fields),
      matchConfidence: confidence,
    },
  });
  await version(tx, record.id, "EXTRACTED");
  return record.id;
}

export const listInputSchema = z
  .object({
    search: z.string().max(200).default(""),
    reviewStatus: z.enum(["NEEDS_REVIEW", "APPROVED", "REJECTED"]).optional(),
    status: z.string().max(30).optional(),
    category: z.string().max(160).optional(),
    symbol: z.string().max(30).optional(),
    after: z.iso.date().optional(),
    before: z.iso.date().optional(),
    minConfidence: z.coerce.number().min(0).max(1).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export async function listRecommendations(
  input: z.infer<typeof listInputSchema>,
  database: PrismaClient = db,
) {
  const where: Prisma.RecommendationWhereInput = {
    reviewStatus: input.reviewStatus,
    status: input.status,
    category: input.category ? { contains: input.category } : undefined,
    symbol: input.symbol ? { contains: input.symbol } : undefined,
    extractionConfidence:
      input.minConfidence === undefined
        ? undefined
        : { gte: input.minConfidence },
    availableAt: {
      ...(input.after ? { gte: new Date(input.after) } : {}),
      ...(input.before ? { lt: new Date(input.before) } : {}),
    },
    ...(input.search
      ? {
          OR: [
            { companyName: { contains: input.search } },
            { symbol: { contains: input.search } },
            { category: { contains: input.search } },
          ],
        }
      : {}),
  };
  const [records, total] = await Promise.all([
    database.recommendation.findMany({
      where,
      orderBy: [{ availableAt: "desc" }, { id: "asc" }],
      take: 50,
      skip: (input.page - 1) * 50,
      include: includeRecommendation,
    }),
    database.recommendation.count({ where }),
  ]);
  return { records, total, page: input.page };
}
