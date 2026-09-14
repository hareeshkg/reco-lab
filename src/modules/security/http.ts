import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, safeLog } from "./errors";

export function protectRequest(request: Request) {
  const configured = new URL(
    process.env.APP_BASE_URL ?? "http://localhost:3000",
  );
  if (request.headers.get("host") !== configured.host)
    throw new AppError("LOCAL_HOST_REQUIRED", 403);
  const isOAuthCallback =
    request.method === "GET" &&
    new URL(request.url).pathname === "/api/auth/google/callback";
  if (
    !isOAuthCallback &&
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError("CROSS_SITE_REQUEST_BLOCKED", 403);
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== configured.origin
  )
    throw new AppError("SAME_ORIGIN_REQUIRED", 403);
}

export async function requestJson<T>(request: Request, schema: z.ZodType<T>) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("JSON_REQUIRED", 415);
  const text = await request.text();
  if (text.length > 100_000) throw new AppError("REQUEST_TOO_LARGE", 413);
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new AppError("INVALID_REQUEST_FIELDS");
  }
}

export function respond<T>(schema: z.ZodType<T>, value: unknown) {
  return NextResponse.json(schema.parse(value), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleApi(
  request: NextRequest,
  operation: () => Promise<NextResponse>,
) {
  try {
    protectRequest(request);
    return await operation();
  } catch (error) {
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof z.ZodError
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR_CHECK_CONFIGURATION";
    safeLog(code);
    return NextResponse.json(
      { error: code },
      {
        status:
          error instanceof AppError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 500,
      },
    );
  }
}
