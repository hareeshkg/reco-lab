import { z } from "zod";

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    cache: "no-store",
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(error.success ? error.data.error : "REQUEST_FAILED");
  }
  return schema.parse(data);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}
export const okSchema = z.object({ ok: z.literal(true) });
