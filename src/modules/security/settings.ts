import { z } from "zod";
import { db } from "./db";
import { configurationStatus, GMAIL_SCOPE } from "./env";

export const statusSchema = z.object({
  connected: z.boolean(),
  email: z.email().nullable(),
  scope: z.literal(GMAIL_SCOPE),
  configuration: z.object({
    valid: z.boolean(),
    oauthConfigured: z.boolean(),
    errors: z.array(z.string()),
  }),
});
export async function connectionStatus() {
  const configuration = configurationStatus();
  if (!configuration.valid)
    return { connected: false, email: null, scope: GMAIL_SCOPE, configuration };
  try {
    const account = await db.gmailAccount.findFirst({
      where: { disconnectedAt: null, encryptedRefreshToken: { not: null } },
      select: { email: true, scope: true },
    });
    return statusSchema.parse({
      connected: Boolean(account),
      email: account?.email ?? null,
      scope: GMAIL_SCOPE,
      configuration,
    });
  } catch {
    return {
      connected: false,
      email: null,
      scope: GMAIL_SCOPE,
      configuration: {
        ...configuration,
        valid: false,
        errors: ["Database unavailable. Run npm run db:migrate."],
      },
    };
  }
}

export async function deleteLocalData() {
  await db.$transaction(async (tx) => {
    await tx.recommendation.deleteMany();
    await tx.sourceMessage.deleteMany();
    await tx.emailSource.deleteMany();
    await tx.gmailAccount.deleteMany();
    await tx.oAuthAttempt.deleteMany();
    await tx.auditLog.deleteMany();
  });
  return { ok: true as const };
}
