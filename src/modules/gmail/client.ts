import { z } from "zod";
import { connectedClient } from "./oauth";
import {
  boundedQuery,
  gmailId,
  messageSchema,
  metadata,
  previewSchema,
  querySchema,
} from "./contracts";
import { AppError } from "@/modules/security/errors";

export async function withBackoff<T>(
  operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const parsed = z
        .object({
          response: z.object({ status: z.number() }).optional(),
          code: z.union([z.number(), z.string()]).optional(),
        })
        .safeParse(error);
      const status = parsed.success
        ? (parsed.data.response?.status ?? Number(parsed.data.code))
        : 0;
      const quota = z
        .object({
          response: z.object({
            data: z.object({
              error: z.object({
                errors: z.array(z.object({ reason: z.string() })),
              }),
            }),
          }),
        })
        .safeParse(error);
      const rateLimited =
        status === 403 &&
        quota.success &&
        quota.data.response.data.error.errors.some((item) =>
          ["rateLimitExceeded", "userRateLimitExceeded"].includes(item.reason),
        );
      if (
        (!rateLimited && ![429, 500, 502, 503, 504].includes(status)) ||
        attempt >= 4
      )
        throw new AppError(
          status === 401 || status === 403
            ? "GMAIL_ACCESS_DENIED_RECONNECT"
            : "GMAIL_REQUEST_FAILED",
          502,
        );
      await wait(250 * 2 ** attempt);
    }
  }
}

export async function gmailGateway() {
  const { api, account } = await connectedClient();
  return {
    accountEmail: account.email,
    async list(query: string, pageToken?: string) {
      const response = await withBackoff(() =>
        api.users.messages.list({
          userId: "me",
          q: query,
          pageToken,
          maxResults: 50,
        }),
      );
      return z
        .object({
          messages: z.array(z.object({ id: gmailId })).default([]),
          nextPageToken: z.string().optional(),
          resultSizeEstimate: z.number().default(0),
        })
        .parse(response.data);
    },
    async get(id: string, format: "full" | "metadata" = "full") {
      return messageSchema.parse(
        (
          await withBackoff(() =>
            api.users.messages.get({
              userId: "me",
              id,
              format,
              ...(format === "metadata"
                ? { metadataHeaders: ["From", "Subject", "Date"] }
                : {}),
            }),
          )
        ).data,
      );
    },
    async attachment(messageId: string, id: string) {
      return z.object({ data: z.string().max(40_000_000) }).parse(
        (
          await withBackoff(() =>
            api.users.messages.attachments.get({
              userId: "me",
              messageId,
              id,
            }),
          )
        ).data,
      ).data;
    },
  };
}
export type GmailGateway = Awaited<ReturnType<typeof gmailGateway>>;

export async function preview(
  input: z.infer<typeof querySchema>,
  gateway?: GmailGateway,
) {
  const client = gateway ?? (await gmailGateway());
  const page = await client.list(boundedQuery(input), input.pageToken);
  const messages = [];
  for (const message of page.messages)
    messages.push(metadata(await client.get(message.id, "metadata")));
  const dates = messages.map((message) => message.receivedAt).sort();
  return previewSchema.parse({
    messages,
    nextPageToken: page.nextPageToken ?? null,
    estimatedTotal: page.resultSizeEstimate,
    senders: [...new Set(messages.map((message) => message.from))],
    subjects: [...new Set(messages.map((message) => message.subject))],
    dateCoverage: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
  });
}
