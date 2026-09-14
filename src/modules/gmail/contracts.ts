import { z } from "zod";

export const gmailId = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
export const headerSchema = z.object({ name: z.string(), value: z.string() });
export interface MimePart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name: string; value: string }[] | null;
  body?: {
    data?: string | null;
    attachmentId?: string | null;
    size?: number | null;
  } | null;
  parts?: MimePart[] | null;
}
export const partSchema: z.ZodType<MimePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().nullish(),
    filename: z.string().nullish(),
    headers: z.array(headerSchema).nullish(),
    body: z
      .object({
        data: z.string().max(40_000_000).nullish(),
        attachmentId: gmailId.nullish(),
        size: z.number().nullish(),
      })
      .nullish(),
    parts: z.array(partSchema).max(200).nullish(),
  }),
);
export const messageSchema = z.object({
  id: gmailId,
  threadId: gmailId,
  internalDate: z
    .string()
    .regex(/^\d{1,15}$/)
    .refine((value) => Number(value) > 0 && Number(value) < 8.64e15),
  payload: partSchema,
});
export type GmailMessage = z.infer<typeof messageSchema>;
export const querySchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    after: z.iso.date().optional(),
    before: z.iso.date().optional(),
    pageToken: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => !value.after || !value.before || value.after < value.before,
    { message: "End date must be after start date" },
  );
export const metadataSchema = z.object({
  id: gmailId,
  threadId: gmailId,
  from: z.email(),
  subject: z.string().max(1000),
  receivedAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
});
export type MessageMetadata = z.infer<typeof metadataSchema>;
export const previewSchema = z.object({
  messages: z.array(metadataSchema),
  nextPageToken: z.string().nullable(),
  estimatedTotal: z.number(),
  senders: z.array(z.string()),
  subjects: z.array(z.string()),
  dateCoverage: z.object({
    first: z.string().nullable(),
    last: z.string().nullable(),
  }),
});
export const sourceInputSchema = z
  .object({
    provider: z.literal("Axis Direct"),
    query: z.string().trim().min(1).max(1000),
    after: z.iso.date().optional(),
    before: z.iso.date().optional(),
    acceptedSenders: z.array(z.email()).min(1).max(100),
    subjectPatterns: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (value) => !value.after || !value.before || value.after < value.before,
    { message: "End date must be after start date" },
  );
export const importInputSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    messageIds: z.array(gmailId).min(1).max(50),
  })
  .strict();
export const importResultSchema = z.object({
  results: z.array(
    z.object({
      gmailMessageId: gmailId,
      id: z.string().nullable(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ),
});

export function boundedQuery(input: z.infer<typeof querySchema>) {
  return [
    input.query,
    input.after
      ? `after:${Math.floor(Date.parse(input.after + "T00:00:00Z") / 1000)}`
      : "",
    input.before
      ? `before:${Math.floor(Date.parse(input.before + "T00:00:00Z") / 1000)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function metadata(message: GmailMessage): MessageMetadata {
  const header = (name: string) =>
    message.payload.headers?.find((item) => item.name.toLowerCase() === name)
      ?.value ?? "";
  const rawFrom = header("from");
  const from = (rawFrom.match(/<([^<>]+)>/)?.[1] ?? rawFrom)
    .trim()
    .toLowerCase();
  const sent = Date.parse(header("date"));
  return metadataSchema.parse({
    id: message.id,
    threadId: message.threadId,
    from,
    subject: header("subject").slice(0, 1000),
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    sentAt: Number.isNaN(sent) ? null : new Date(sent).toISOString(),
  });
}

export function matchesSource(
  message: MessageMetadata,
  source: {
    acceptedSenders: string[];
    subjectPatterns: string[];
    after?: string | null;
    before?: string | null;
  },
) {
  return (
    source.acceptedSenders.some(
      (sender) => sender.toLowerCase() === message.from.toLowerCase(),
    ) &&
    source.subjectPatterns.some((pattern) =>
      message.subject.toLowerCase().includes(pattern.toLowerCase()),
    ) &&
    (!source.after || message.receivedAt >= source.after + "T00:00:00.000Z") &&
    (!source.before || message.receivedAt < source.before + "T00:00:00.000Z")
  );
}
