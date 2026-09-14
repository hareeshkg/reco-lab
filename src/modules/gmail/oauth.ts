import { randomBytes } from "node:crypto";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { gmail } from "googleapis/build/src/apis/gmail";
import { z } from "zod";
import { db } from "@/modules/security/db";
import { GMAIL_SCOPE, readEnv } from "@/modules/security/env";
import {
  decrypt,
  encrypt,
  equalSecret,
  sha256,
} from "@/modules/security/crypto";
import { AppError } from "@/modules/security/errors";

export function oauthClient() {
  const env = readEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new AppError("OAUTH_NOT_CONFIGURED");
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

export async function beginOAuth() {
  const client = oauthClient();
  const state = randomBytes(32).toString("base64url");
  const { codeVerifier, codeChallenge } =
    await client.generateCodeVerifierAsync();
  await db.oAuthAttempt.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  await db.oAuthAttempt.create({
    data: {
      stateHash: sha256(state),
      encryptedVerifier: encrypt(codeVerifier),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_SCOPE],
    include_granted_scopes: false,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  return { state, url };
}

export function validateOAuthState(state: string, cookie: string | undefined) {
  if (!cookie || !equalSecret(state, cookie))
    throw new AppError("INVALID_OAUTH_STATE");
}

export function validateScope(scope: string) {
  if (scope.trim().split(/\s+/).length !== 1 || scope.trim() !== GMAIL_SCOPE)
    throw new AppError("UNEXPECTED_OAUTH_SCOPE");
}

export async function completeOAuth(
  code: string,
  state: string,
  cookie?: string,
) {
  validateOAuthState(state, cookie);
  const attempt = await db.oAuthAttempt.findUnique({
    where: { stateHash: sha256(state) },
  });
  if (!attempt || attempt.expiresAt.getTime() < Date.now())
    throw new AppError("OAUTH_STATE_EXPIRED");
  const consumed = await db.oAuthAttempt.deleteMany({
    where: { stateHash: attempt.stateHash },
  });
  if (consumed.count !== 1) throw new AppError("OAUTH_STATE_REUSED");
  const client = oauthClient();
  const { tokens } = await client.getToken({
    code,
    codeVerifier: decrypt(attempt.encryptedVerifier),
  });
  if (!tokens.access_token || !tokens.refresh_token)
    throw new AppError("REFRESH_TOKEN_REQUIRED");
  const tokenInfo = await client.getTokenInfo(tokens.access_token);
  validateScope(tokenInfo.scopes.join(" "));
  client.setCredentials(tokens);
  const profile = z.object({ emailAddress: z.email() }).parse(
    (
      await gmail({ version: "v1", auth: client }).users.getProfile({
        userId: "me",
      })
    ).data,
  );
  await db.$transaction(async (tx) => {
    await tx.gmailAccount.updateMany({
      data: { encryptedRefreshToken: null, disconnectedAt: new Date() },
    });
    await tx.gmailAccount.upsert({
      where: { email: profile.emailAddress },
      create: {
        email: profile.emailAddress,
        encryptedRefreshToken: encrypt(tokens.refresh_token!),
        scope: GMAIL_SCOPE,
      },
      update: {
        encryptedRefreshToken: encrypt(tokens.refresh_token!),
        scope: GMAIL_SCOPE,
        connectedAt: new Date(),
        disconnectedAt: null,
      },
    });
    await tx.auditLog.create({ data: { action: "GMAIL_CONNECTED" } });
  });
}

export async function connectedClient() {
  const account = await db.gmailAccount.findFirst({
    where: { disconnectedAt: null, encryptedRefreshToken: { not: null } },
  });
  if (!account?.encryptedRefreshToken)
    throw new AppError("GMAIL_NOT_CONNECTED", 409);
  validateScope(account.scope);
  const client = oauthClient();
  client.setCredentials({
    refresh_token: decrypt(account.encryptedRefreshToken),
  });
  return { account, client, api: gmail({ version: "v1", auth: client }) };
}

export async function disconnect() {
  await db.$transaction(async (tx) => {
    await tx.gmailAccount.updateMany({
      data: { encryptedRefreshToken: null, disconnectedAt: new Date() },
    });
    await tx.oAuthAttempt.deleteMany();
    await tx.auditLog.create({ data: { action: "GMAIL_DISCONNECTED" } });
  });
  return { ok: true as const };
}
