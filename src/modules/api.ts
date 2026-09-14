import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./security/db";
import { beginOAuth, completeOAuth, disconnect } from "./gmail/oauth";
import {
  connectionStatus,
  deleteLocalData,
  statusSchema,
} from "./security/settings";
import { requestJson, respond } from "./security/http";
import { AppError } from "./security/errors";
import { readEnv } from "./security/env";
import { preview } from "./gmail/client";
import {
  importMessages,
  saveSource,
  reparseRecommendation,
  createManualRecommendation,
} from "./gmail/ingestion";
import {
  importInputSchema,
  importResultSchema,
  previewSchema,
  querySchema,
  sourceInputSchema,
} from "./gmail/contracts";
import {
  correctRecommendation,
  correctionSchema,
  decideRecommendation,
  decisionSchema,
  getRecommendation,
  listInputSchema,
  listRecommendations,
} from "./recommendations/service";
import {
  messageView,
  recommendationListSchema,
  recommendationView,
  recommendationViewSchema,
  sourceMessageViewSchema,
} from "./recommendations/views";
import { fieldsSchema } from "./parsing/contracts";

const okSchema = z.object({ ok: z.literal(true) });
const sourceSchema = z.object({
  id: z.string(),
  provider: z.string(),
  gmailQuery: z.string(),
  accountEmail: z.string(),
  acceptedSendersJson: z.string(),
  subjectPatternsJson: z.string(),
  after: z.string().nullable(),
  before: z.string().nullable(),
});
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);

export async function dispatch(request: NextRequest, segments: string[]) {
  const path = segments.join("/");
  const method = request.method;
  if (method === "GET" && path === "auth/status")
    return respond(statusSchema, await connectionStatus());
  if (method === "GET" && path === "auth/google") {
    const { state, url } = await beginOAuth();
    const response = NextResponse.redirect(url);
    response.cookies.set("recolab_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/api/auth/google/callback",
      maxAge: 600,
    });
    return response;
  }
  if (method === "GET" && path === "auth/google/callback") {
    const params = z
      .object({
        code: z.string().min(1).max(4000),
        state: z.string().min(1).max(200),
      })
      .safeParse(Object.fromEntries(request.nextUrl.searchParams));
    const response = NextResponse.redirect(
      new URL("/setup", readEnv().APP_BASE_URL),
    );
    response.cookies.set("recolab_oauth_state", "", {
      path: "/api/auth/google/callback",
      maxAge: 0,
    });
    if (!params.success)
      return NextResponse.redirect(
        new URL(
          "/setup?error=OAUTH_CANCELLED_OR_INVALID",
          readEnv().APP_BASE_URL,
        ),
      );
    try {
      await completeOAuth(
        params.data.code,
        params.data.state,
        request.cookies.get("recolab_oauth_state")?.value,
      );
    } catch {
      response.headers.set(
        "location",
        new URL(
          "/setup?error=OAUTH_FAILED_RECONNECT",
          readEnv().APP_BASE_URL,
        ).toString(),
      );
    }
    return response;
  }
  if (method === "POST" && path === "auth/google/disconnect")
    return respond(okSchema, await disconnect());
  if (method === "POST" && path === "settings/delete-data") {
    await requestJson(
      request,
      z.object({ confirmation: z.literal("DELETE LOCAL DATA") }).strict(),
    );
    return respond(okSchema, await deleteLocalData());
  }
  if (method === "POST" && path === "gmail/preview")
    return respond(
      previewSchema,
      await preview(await requestJson(request, querySchema)),
    );
  if (method === "POST" && path === "gmail/sources")
    return respond(
      sourceSchema,
      await saveSource(await requestJson(request, sourceInputSchema)),
    );
  if (method === "GET" && path === "gmail/sources")
    return respond(
      z.array(sourceSchema),
      await db.emailSource.findMany({
        where: { active: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  if (method === "POST" && path === "gmail/import")
    return respond(
      importResultSchema,
      await importMessages(await requestJson(request, importInputSchema)),
    );
  if (method === "GET" && path === "gmail/imports") {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .parse(request.nextUrl.searchParams.get("page") ?? undefined);
    const [records, total] = await Promise.all([
      db.sourceMessage.findMany({
        take: 50,
        skip: (page - 1) * 50,
        orderBy: { importedAt: "desc" },
      }),
      db.sourceMessage.count(),
    ]);
    return respond(
      z.object({
        records: z.array(sourceMessageViewSchema),
        total: z.number(),
        page: z.number(),
      }),
      { records: records.map(messageView), total, page },
    );
  }
  if (
    method === "GET" &&
    segments[0] === "gmail" &&
    segments[1] === "imports" &&
    segments.length === 3
  ) {
    const record = await db.sourceMessage.findUnique({
      where: { id: idSchema.parse(segments[2]) },
    });
    if (!record) throw new AppError("IMPORT_NOT_FOUND", 404);
    return respond(sourceMessageViewSchema, messageView(record));
  }
  if (method === "GET" && path === "recommendations") {
    const result = await listRecommendations(
      listInputSchema.parse(Object.fromEntries(request.nextUrl.searchParams)),
    );
    return respond(recommendationListSchema, {
      ...result,
      records: result.records.map(recommendationView),
    });
  }
  if (method === "POST" && path === "recommendations") {
    const input = await requestJson(
      request,
      z
        .object({
          sourceMessageId: idSchema,
          fields: fieldsSchema,
          reason: z.string().trim().min(3).max(200),
        })
        .strict(),
    );
    const id = await createManualRecommendation(
      input.sourceMessageId,
      input.fields,
      input.reason,
    );
    return respond(
      recommendationViewSchema,
      recommendationView(await getRecommendation(id)),
    );
  }
  if (
    segments[0] === "recommendations" &&
    segments.length >= 2 &&
    segments.length <= 3
  ) {
    const id = idSchema.parse(segments[1]);
    if (segments.length === 2 && method === "GET")
      return respond(
        recommendationViewSchema,
        recommendationView(await getRecommendation(id)),
      );
    if (segments.length === 2 && method === "PATCH")
      await correctRecommendation(
        id,
        await requestJson(request, correctionSchema),
      );
    else if (
      segments.length === 3 &&
      method === "POST" &&
      ["approve", "reject"].includes(segments[2])
    )
      await decideRecommendation(
        id,
        segments[2] === "approve" ? "APPROVED" : "REJECTED",
        await requestJson(request, decisionSchema),
      );
    else if (
      segments.length === 3 &&
      method === "POST" &&
      segments[2] === "reparse"
    )
      await reparseRecommendation(id);
    else throw new AppError("NOT_FOUND", 404);
    return respond(
      recommendationViewSchema,
      recommendationView(await getRecommendation(id)),
    );
  }
  throw new AppError("NOT_FOUND", 404);
}
