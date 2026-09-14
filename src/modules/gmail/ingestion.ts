import { z } from "zod";
import { db } from "@/modules/security/db";
import { AppError } from "@/modules/security/errors";
import { gmailGateway, type GmailGateway } from "./client";
import {
  boundedQuery,
  matchesSource,
  metadata,
  sourceInputSchema,
  type GmailMessage,
  type MessageMetadata,
  importInputSchema,
} from "./contracts";
import { parseMime } from "@/modules/parsing/mime";
import { extractRecommendations } from "@/modules/parsing/extract";
import { PARSER_VERSION, fieldWarnings } from "@/modules/parsing/contracts";
import {
  includeRecommendation,
  persistExtraction,
} from "@/modules/recommendations/service";

export async function saveSource(
  input: z.infer<typeof sourceInputSchema>,
  gateway?: GmailGateway,
  database = db,
) {
  const client = gateway ?? (await gmailGateway());
  return database.emailSource.create({
    data: {
      provider: input.provider,
      accountEmail: client.accountEmail,
      gmailQuery: input.query,
      after: input.after,
      before: input.before,
      acceptedSendersJson: JSON.stringify(
        input.acceptedSenders.map((sender) => sender.toLowerCase()),
      ),
      subjectPatternsJson: JSON.stringify(input.subjectPatterns),
    },
  });
}

export async function storeMessage(
  message: GmailMessage,
  sourceId: string,
  client: GmailGateway,
  reparse = false,
  database = db,
) {
  const source = await database.emailSource.findUniqueOrThrow({
    where: { id: sourceId },
  });
  const meta = metadata(message);
  const parsed = await parseMime(message, (attachmentId) =>
    client.attachment(message.id, attachmentId),
  );
  const extractions = parsed.texts.flatMap((text) =>
    extractRecommendations(text, source.provider),
  );
  const uniqueExtractions = extractions.filter(
    (value, index, all) =>
      all.findIndex(
        (other) =>
          JSON.stringify(other.fields) === JSON.stringify(value.fields),
      ) === index,
  );
  const warnings = [
    ...parsed.warnings,
    ...(!uniqueExtractions.length
      ? ["NO_RECOMMENDATION_EXTRACTED_MANUAL_ENTRY_AVAILABLE"]
      : []),
  ];
  return database.$transaction(
    async (tx) => {
      const existing = await tx.sourceMessage.findUnique({
        where: {
          accountEmail_gmailMessageId: {
            accountEmail: client.accountEmail,
            gmailMessageId: message.id,
          },
        },
        include: {
          recommendations: {
            orderBy: { ordinal: "asc" },
            include: includeRecommendation,
          },
        },
      });
      if (existing && existing.importStatus !== "FAILED" && !reparse)
        return { id: existing.id, status: "DUPLICATE" };
      if (existing && reparse && existing.recommendations.length) {
        if (
          existing.recommendations.length !== uniqueExtractions.length ||
          existing.recommendations.some((record, index) => {
            const original = JSON.parse(
              record.versions.at(-1)?.snapshotJson ?? "{}",
            ) as { symbol?: string; companyName?: string };
            const candidate = uniqueExtractions[index].fields;
            return original.symbol
              ? original.symbol !== candidate.symbol
              : original.companyName !== candidate.companyName;
          })
        )
          throw new AppError(
            "REPARSE_STRUCTURE_CHANGED_MANUAL_REVIEW_REQUIRED",
            409,
          );
      }
      const data = {
        gmailThreadId: message.threadId,
        receivedAt: new Date(meta.receivedAt),
        sentAt: meta.sentAt ? new Date(meta.sentAt) : null,
        fromAddress: meta.from,
        subject: meta.subject,
        contentSha256: parsed.contentSha256,
        hasPdfAttachment: parsed.hasPdfAttachment,
        importStatus: warnings.length ? "NEEDS_REVIEW" : "PARSED",
        parserVersion: PARSER_VERSION,
        warningsJson: JSON.stringify(warnings),
        errorCode: null,
        errorMessage: null,
      };
      const record = existing
        ? await tx.sourceMessage.update({ where: { id: existing.id }, data })
        : await tx.sourceMessage.create({
            data: {
              ...data,
              gmailMessageId: message.id,
              accountEmail: client.accountEmail,
              sourceId,
            },
          });
      for (const [ordinal, extraction] of uniqueExtractions.entries())
        await persistExtraction(
          tx,
          record.id,
          record.receivedAt,
          ordinal,
          {
            ...extraction,
            warnings: [...extraction.warnings, ...parsed.warnings],
          },
          existing?.recommendations[ordinal],
        );
      await tx.auditLog.create({
        data: {
          action: reparse ? "MESSAGE_REPARSED" : "MESSAGE_IMPORTED",
          entityId: record.id,
        },
      });
      return { id: record.id, status: data.importStatus };
    },
    { timeout: 15000 },
  );
}

export async function importMessages(
  input: z.infer<typeof importInputSchema>,
  gateway?: GmailGateway,
  database = db,
) {
  const client = gateway ?? (await gmailGateway());
  const source = await database.emailSource.findUnique({
    where: { id: input.sourceId },
  });
  if (!source || !source.active || source.accountEmail !== client.accountEmail)
    throw new AppError("SOURCE_NOT_AVAILABLE", 404);
  const selected = new Set(input.messageIds);
  const eligible = new Set<string>();
  let pageToken: string | undefined;
  const visited = new Set<string>();
  do {
    const page = await client.list(
      boundedQuery({
        query: source.gmailQuery,
        after: source.after ?? undefined,
        before: source.before ?? undefined,
      }),
      pageToken,
    );
    for (const message of page.messages)
      if (selected.has(message.id)) eligible.add(message.id);
    pageToken = page.nextPageToken;
    if (pageToken && visited.has(pageToken))
      throw new AppError("GMAIL_PAGINATION_LOOP", 502);
    if (pageToken) visited.add(pageToken);
  } while (pageToken && eligible.size < selected.size);
  const results = [];
  for (const messageId of selected) {
    let meta: MessageMetadata | undefined;
    try {
      if (!eligible.has(messageId)) throw new AppError("MESSAGE_OUTSIDE_QUERY");
      meta = metadata(await client.get(messageId, "metadata"));
      if (
        !matchesSource(meta, {
          acceptedSenders: z
            .array(z.email())
            .parse(JSON.parse(source.acceptedSendersJson)),
          subjectPatterns: z
            .array(z.string())
            .parse(JSON.parse(source.subjectPatternsJson)),
          after: source.after,
          before: source.before,
        })
      )
        throw new AppError("MESSAGE_OUTSIDE_CONFIRMED_SOURCE");
      const existing = await database.sourceMessage.findUnique({
        where: {
          accountEmail_gmailMessageId: {
            accountEmail: client.accountEmail,
            gmailMessageId: messageId,
          },
        },
      });
      if (existing && existing.importStatus !== "FAILED") {
        results.push({
          gmailMessageId: messageId,
          id: existing.id,
          status: "DUPLICATE",
          error: null,
        });
        continue;
      }
      const result = await storeMessage(
        await client.get(messageId),
        source.id,
        client,
        false,
        database,
      );
      results.push({ gmailMessageId: messageId, ...result, error: null });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "IMPORT_FAILED";
      let id: string | null = null;
      if (meta && !code.startsWith("MESSAGE_OUTSIDE")) {
        const failed = await database.sourceMessage.upsert({
          where: {
            accountEmail_gmailMessageId: {
              accountEmail: client.accountEmail,
              gmailMessageId: messageId,
            },
          },
          create: {
            gmailMessageId: messageId,
            accountEmail: client.accountEmail,
            gmailThreadId: meta.threadId,
            sourceId: source.id,
            receivedAt: new Date(meta.receivedAt),
            fromAddress: meta.from,
            subject: meta.subject,
            contentSha256: "",
            hasPdfAttachment: false,
            importStatus: "FAILED",
            parserVersion: PARSER_VERSION,
            errorCode: code,
            errorMessage: code,
          },
          update: {},
        });
        id = failed.id;
      }
      results.push({
        gmailMessageId: messageId,
        id,
        status: "FAILED",
        error: code,
      });
    }
  }
  return { results };
}

export async function reparseRecommendation(id: string) {
  const record = await db.recommendation.findUnique({
    where: { id },
    include: { sourceMessage: true },
  });
  if (!record) throw new AppError("RECOMMENDATION_NOT_FOUND", 404);
  const client = await gmailGateway();
  if (record.sourceMessage.accountEmail !== client.accountEmail)
    throw new AppError("CONNECT_ORIGINAL_GMAIL_ACCOUNT", 409);
  return storeMessage(
    await client.get(record.sourceMessage.gmailMessageId),
    record.sourceMessage.sourceId,
    client,
    true,
  );
}

export async function createManualRecommendation(
  sourceMessageId: string,
  fields: z.infer<typeof import("@/modules/parsing/contracts").fieldsSchema>,
  reason: string,
  database = db,
) {
  return database.$transaction(async (tx) => {
    const source = await tx.sourceMessage.findUnique({
      where: { id: sourceMessageId },
    });
    if (!source) throw new AppError("SOURCE_MESSAGE_NOT_FOUND", 404);
    const last = await tx.recommendation.findFirst({
      where: { sourceMessageId },
      orderBy: { ordinal: "desc" },
    });
    const id = await persistExtraction(
      tx,
      source.id,
      source.receivedAt,
      (last?.ordinal ?? -1) + 1,
      {
        fields,
        parserVersion: PARSER_VERSION,
        confidence: 0,
        warnings: [
          "MANUAL_ENTRY_REQUIRES_REVIEW",
          ...fieldWarnings(fields),
          ...z.array(z.string()).parse(JSON.parse(source.warningsJson)),
        ],
        evidence: Object.entries(fields)
          .filter(([, value]) => value !== null)
          .map(([fieldName, value]) => ({
            fieldName,
            extractedValue: JSON.stringify(value),
            evidenceSnippet: reason,
            confidence: 1,
            extractionMethod: "MANUAL",
          })),
      },
    );
    await tx.auditLog.create({
      data: { action: "RECOMMENDATION_MANUALLY_CREATED", entityId: id },
    });
    return id;
  });
}
