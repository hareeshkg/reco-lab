import { z } from "zod";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const localUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}, "Use a local HTTP URL for this private PoC");
const envSchema = z
  .object({
    APP_BASE_URL: localUrl.default("http://localhost:3000"),
    DATABASE_URL: z.string().startsWith("file:"),
    APP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, "Generate a 32-byte hex encryption key"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: localUrl.default(
      "http://localhost:3000/api/auth/google/callback",
    ),
    GMAIL_SCOPE: z.literal(GMAIL_SCOPE).default(GMAIL_SCOPE),
    AI_EXTRACTION_ENABLED: z.literal("false").default("false"),
    STORE_RAW_EMAILS: z.literal("false").default("false"),
    STORE_RAW_ATTACHMENTS: z.literal("false").default("false"),
    UPDATE_MATCH_WINDOW_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(90),
  })
  .refine(
    (value) =>
      value.GOOGLE_REDIRECT_URI ===
      `${value.APP_BASE_URL}/api/auth/google/callback`,
    {
      message: "OAuth redirect must match APP_BASE_URL",
      path: ["GOOGLE_REDIRECT_URI"],
    },
  );

export function readEnv(
  input: Record<string, string | undefined> = process.env,
) {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ]),
  );
  return envSchema.parse(normalized);
}

export function configurationStatus() {
  try {
    const env = readEnv();
    return {
      valid: true,
      oauthConfigured: Boolean(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
      ),
      errors: [] as string[],
    };
  } catch (error) {
    return {
      valid: false,
      oauthConfigured: false,
      errors:
        error instanceof z.ZodError
          ? error.issues.map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`,
            )
          : ["Configuration invalid"],
    };
  }
}
