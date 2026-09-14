import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { testDatabase } from "./database";
import { syntheticMessage, textPart, plainCall } from "./fixtures/messages";
import {
  importMessages,
  saveSource,
  storeMessage,
  createManualRecommendation,
} from "../src/modules/gmail/ingestion";
import type { GmailGateway } from "../src/modules/gmail/client";
import { preview } from "../src/modules/gmail/client";
import type { GmailMessage } from "../src/modules/gmail/contracts";
import {
  correctRecommendation,
  decideRecommendation,
  getRecommendation,
  listRecommendations,
  recommendationFields,
} from "../src/modules/recommendations/service";
import { recommendationView } from "../src/modules/recommendations/views";

let database: PrismaClient;
let directory: string;
const sourceInput = {
  provider: "Axis Direct" as const,
  query: "Synthetic",
  acceptedSenders: ["research@example.test"],
  subjectPatterns: ["Axis research"],
  confirmed: true as const,
};
function gateway(messages = [syntheticMessage()]) {
  const calls: string[] = [];
  const client: GmailGateway = {
    accountEmail: "owner@example.test",
    async list(_query, pageToken) {
      calls.push(`list:${pageToken ?? "first"}`);
      return {
        messages: messages.map((message) => ({ id: message.id })),
        resultSizeEstimate: messages.length,
      };
    },
    async get(id, format) {
      calls.push(`get:${id}:${format ?? "full"}`);
      const message = messages.find((message) => message.id === id);
      if (!message) throw new Error("synthetic missing");
      return message;
    },
    async attachment() {
      throw new Error("No synthetic attachment");
    },
  };
  return { client, calls };
}
beforeAll(() => {
  ({ database, directory } = testDatabase());
}, 30000);
afterAll(async () => {
  await database?.$disconnect();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await database.recommendation.deleteMany();
  await database.sourceMessage.deleteMany();
  await database.emailSource.deleteMany();
  await database.auditLog.deleteMany();
});

describe("Gmail ingestion with SQLite", () => {
  it("previews metadata only and exposes next-page cursor", async () => {
    const { client, calls } = gateway();
    client.list = async () => ({
      messages: [{ id: "synthetic-1" }],
      resultSizeEstimate: 80,
      nextPageToken: "second",
    });
    const result = await preview({ query: "Synthetic" }, client);
    expect(result.nextPageToken).toBe("second");
    expect(result.senders).toEqual(["research@example.test"]);
    expect(calls).toEqual(["get:synthetic-1:metadata"]);
  });
  it("imports idempotently without retaining raw message bodies", async () => {
    const { client, calls } = gateway();
    const source = await saveSource(sourceInput, client, database);
    const input = { sourceId: source.id, messageIds: ["synthetic-1"] };
    expect(
      (await importMessages(input, client, database)).results[0].status,
    ).toBe("PARSED");
    expect(
      (await importMessages(input, client, database)).results[0].status,
    ).toBe("DUPLICATE");
    expect(await database.recommendation.count()).toBe(1);
    expect(await database.sourceMessage.count()).toBe(1);
    expect(calls.filter((call) => call.endsWith(":full"))).toHaveLength(1);
    const sourceRecord = await database.sourceMessage.findFirstOrThrow();
    expect(sourceRecord.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(sourceRecord)).not.toContain(
      "Synthetic growth assumption",
    );
    const record = await database.recommendation.findFirstOrThrow();
    expect(
      (await getRecommendation(record.id, database)).versions,
    ).toHaveLength(1);
  });
  it("checks sender and query membership before fetching full content", async () => {
    const message = syntheticMessage();
    message.payload.headers![0].value = "outsider@example.test";
    const { client, calls } = gateway([message]);
    const source = await saveSource(sourceInput, client, database);
    const result = await importMessages(
      { sourceId: source.id, messageIds: [message.id, "outside-query"] },
      client,
      database,
    );
    expect(result.results.map((item) => item.error)).toEqual([
      "MESSAGE_OUTSIDE_CONFIRMED_SOURCE",
      "MESSAGE_OUTSIDE_QUERY",
    ]);
    expect(calls.some((call) => call.endsWith(":full"))).toBe(false);
    expect(await database.sourceMessage.count()).toBe(0);
  });
  it("paginates selection verification", async () => {
    const { client } = gateway();
    const source = await saveSource(sourceInput, client, database);
    const pages: (string | undefined)[] = [];
    client.list = async (_query, token) => {
      pages.push(token);
      return token
        ? { messages: [{ id: "synthetic-1" }], resultSizeEstimate: 51 }
        : {
            messages: [{ id: "other" }],
            resultSizeEstimate: 51,
            nextPageToken: "next",
          };
    };
    expect(
      (
        await importMessages(
          { sourceId: source.id, messageIds: ["synthetic-1"] },
          client,
          database,
        )
      ).results[0].status,
    ).toBe("PARSED");
    expect(pages).toEqual([undefined, "next"]);
  });
  it("persists failures and resumes interrupted imports", async () => {
    const { client } = gateway();
    const originalGet = client.get;
    let fail = true;
    client.get = async (id, format) => {
      if (format !== "metadata" && fail)
        throw new Error("synthetic error with secret token");
      return originalGet(id, format);
    };
    const source = await saveSource(sourceInput, client, database);
    const input = { sourceId: source.id, messageIds: ["synthetic-1"] };
    expect(
      (await importMessages(input, client, database)).results[0].error,
    ).toBe("IMPORT_FAILED");
    expect(
      (await database.sourceMessage.findFirstOrThrow()).errorMessage,
    ).not.toContain("secret");
    fail = false;
    expect(
      (await importMessages(input, client, database)).results[0].status,
    ).toBe("PARSED");
    expect(await database.sourceMessage.count()).toBe(1);
  });
  it("marks unrecognized content for review without inventing a call", async () => {
    const { client } = gateway([
      syntheticMessage(
        "empty",
        textPart("Synthetic newsletter without any stock call"),
      ),
    ]);
    const source = await saveSource(sourceInput, client, database);
    expect(
      (
        await importMessages(
          { sourceId: source.id, messageIds: ["empty"] },
          client,
          database,
        )
      ).results[0].status,
    ).toBe("NEEDS_REVIEW");
    expect(await database.recommendation.count()).toBe(0);
  });
  it("isolates identical message IDs across Gmail accounts", async () => {
    const { client } = gateway();
    const source = await saveSource(sourceInput, client, database);
    await importMessages(
      { sourceId: source.id, messageIds: ["synthetic-1"] },
      client,
      database,
    );
    client.accountEmail = "second@example.test";
    await expect(
      importMessages(
        { sourceId: source.id, messageIds: ["synthetic-1"] },
        client,
        database,
      ),
    ).rejects.toThrow("SOURCE_NOT_AVAILABLE");
    const second = await saveSource(sourceInput, client, database);
    await importMessages(
      { sourceId: second.id, messageIds: ["synthetic-1"] },
      client,
      database,
    );
    expect(await database.sourceMessage.count()).toBe(2);
  });
});

describe("manual review, lifecycle and audit", () => {
  it("creates a missed call with protected manual fields, evidence and warnings", async () => {
    const { record } = await imported();
    const fields = {
      ...recommendationFields(record),
      companyName: "Manual Synthetic Ltd",
      stopLoss: null,
    };
    const id = await createManualRecommendation(
      record.sourceMessageId,
      fields,
      "Manually checked synthetic source",
      database,
    );
    const manual = await getRecommendation(id, database);
    expect(manual.reviewStatus).toBe("NEEDS_REVIEW");
    expect(JSON.parse(manual.manualFieldsJson)).toContain("companyName");
    expect(JSON.parse(manual.warningsJson)).toContain("MISSING_STOP_LOSS");
    expect(manual.evidence[0].evidenceSnippet).toBe(
      "Manually checked synthetic source",
    );
    expect(JSON.parse(manual.versions[0].snapshotJson).manualFieldsJson).toBe(
      manual.manualFieldsJson,
    );
  });
  it("preserves MIME quality warnings after field corrections", async () => {
    const message = syntheticMessage("partial", {
      mimeType: "multipart/mixed",
      parts: [
        textPart(),
        { mimeType: "application/zip", filename: "unsupported.zip" },
      ],
    });
    const { record } = await imported([message]);
    await correctRecommendation(
      record.id,
      {
        fields: { ...recommendationFields(record), stopLoss: 1000 },
        revision: 1,
        reason: "Synthetic correction",
      },
      database,
    );
    expect(
      JSON.parse((await getRecommendation(record.id, database)).warningsJson),
    ).toContain("UNSUPPORTED_ATTACHMENT");
  });
  async function imported(messages: GmailMessage[] = [syntheticMessage()]) {
    const { client } = gateway(messages);
    const source = await saveSource(sourceInput, client, database);
    await importMessages(
      {
        sourceId: source.id,
        messageIds: messages.map((message) => message.id),
      },
      client,
      database,
    );
    const record = await database.recommendation.findFirstOrThrow({
      orderBy: { availableAt: "asc" },
    });
    return {
      client,
      source,
      record: await getRecommendation(record.id, database),
    };
  }
  it("versions corrections, approvals and rejection, with stale-write protection", async () => {
    const { record } = await imported();
    const fields = { ...recommendationFields(record), stopLoss: 1080 };
    await correctRecommendation(
      record.id,
      { fields, revision: 1, reason: "Verified synthetic stop" },
      database,
    );
    await expect(
      correctRecommendation(
        record.id,
        { fields, revision: 1, reason: "Stale edit" },
        database,
      ),
    ).rejects.toThrow("REVISION_CONFLICT_RELOAD");
    await expect(
      decideRecommendation(
        record.id,
        "APPROVED",
        { revision: 2, acknowledgeWarnings: false },
        database,
      ),
    ).rejects.toThrow("ACKNOWLEDGE_DATA_WARNINGS");
    await decideRecommendation(
      record.id,
      "APPROVED",
      { revision: 2, acknowledgeWarnings: true },
      database,
    );
    await decideRecommendation(
      record.id,
      "REJECTED",
      { revision: 3, acknowledgeWarnings: false },
      database,
    );
    const updated = await getRecommendation(record.id, database);
    expect(updated.versions).toHaveLength(4);
    expect(updated.reviewStatus).toBe("REJECTED");
    expect(
      updated.evidence.some(
        (evidence) =>
          evidence.fieldName === "stopLoss" &&
          evidence.extractionMethod === "MANUAL",
      ),
    ).toBe(true);
    expect(recommendationView(updated).fields.stopLoss).toBe(1080);
  });
  it("preserves corrections and all approved values across reparse", async () => {
    const { client, source, record } = await imported();
    await correctRecommendation(
      record.id,
      {
        fields: { ...recommendationFields(record), stopLoss: 1080 },
        revision: 1,
        reason: "Synthetic manual correction",
      },
      database,
    );
    await storeMessage(
      syntheticMessage(
        "synthetic-1",
        textPart(plainCall.replace("CMP: Rs. 1,200", "CMP: 1,250")),
      ),
      source.id,
      client,
      true,
      database,
    );
    let updated = await getRecommendation(record.id, database);
    expect(updated.stopLoss).toBe(1080);
    expect(updated.recommendedPrice).toBe(1250);
    await decideRecommendation(
      record.id,
      "APPROVED",
      { revision: updated.revision, acknowledgeWarnings: true },
      database,
    );
    await storeMessage(syntheticMessage(), source.id, client, true, database);
    updated = await getRecommendation(record.id, database);
    expect(updated.stopLoss).toBe(1080);
    expect(updated.recommendedPrice).toBe(1250);
    expect(updated.reviewStatus).toBe("APPROVED");
  });
  it("refuses structural reparse changes instead of moving manual corrections", async () => {
    const { client, source } = await imported();
    await expect(
      storeMessage(
        syntheticMessage(
          "synthetic-1",
          textPart(plainCall + "\n" + plainCall.replaceAll("SYNTH", "SECOND")),
        ),
        source.id,
        client,
        true,
        database,
      ),
    ).rejects.toThrow("REPARSE_STRUCTURE_CHANGED");
    expect(await database.recommendation.count()).toBe(1);
  });
  it("stores revision and closure as timestamped events without rewriting prior calls", async () => {
    const revised = syntheticMessage(
      "revision",
      textPart(
        plainCall.replace("Targets: 1,400 / 1,500", "Revised Target: 1,600"),
      ),
      "2026-01-06T04:00:00Z",
    );
    const closed = syntheticMessage(
      "closure",
      textPart(
        "Company: Synthetic Motors Ltd\nNSE: SYNTH\nReference: SYN-001\nStatus: Closed",
      ),
      "2026-01-07T04:00:00Z",
    );
    const { record } = await imported([syntheticMessage(), revised, closed]);
    expect(record.primaryTarget).toBe(1400);
    expect(record.status).toBe("NEW");
    const events = await database.recommendationEvent.findMany({
      orderBy: { effectiveAt: "asc" },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "NEW",
      "TARGET_REVISED",
      "CLOSED",
    ]);
    expect(events[1].relatedRecommendationId).toBe(record.id);
    expect(events[1].effectiveAt.toISOString()).toBe(
      "2026-01-06T04:00:00.000Z",
    );
    expect(events[2].matchConfidence).toBe(0);
    expect(events[2].reviewStatus).toBe("NEEDS_REVIEW");
  });
  it("does not match an update to information received later", async () => {
    await imported([
      syntheticMessage("future", textPart(), "2026-02-01T00:00:00Z"),
      syntheticMessage(
        "early-update",
        textPart(plainCall + "\nStatus: Closed"),
        "2026-01-01T00:00:00Z",
      ),
    ]);
    const event = await database.recommendationEvent.findFirstOrThrow({
      where: { eventType: "CLOSED" },
    });
    expect(event.relatedRecommendationId).toBeNull();
  });
  it("filters records by review, symbol, confidence and dates", async () => {
    await imported();
    expect(
      (
        await listRecommendations(
          {
            search: "Synthetic",
            page: 1,
            symbol: "SYNTH",
            reviewStatus: "NEEDS_REVIEW",
            after: "2026-01-01",
          },
          database,
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await listRecommendations(
          { search: "", page: 1, minConfidence: 1 },
          database,
        )
      ).total,
    ).toBe(0);
  });
});
