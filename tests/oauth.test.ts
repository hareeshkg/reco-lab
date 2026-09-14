import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { rmSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import { testDatabase } from "./database";
import { GMAIL_SCOPE } from "../src/modules/security/env";
import { decrypt, encrypt, sha256 } from "../src/modules/security/crypto";

const state = vi.hoisted(() => ({
  database: undefined as PrismaClient | undefined,
}));
vi.mock("../src/modules/security/db", () => ({
  get db() {
    return state.database;
  },
}));
vi.mock("googleapis/build/src/apis/gmail", () => ({
  gmail: () => ({
    users: {
      getProfile: async () => ({
        data: { emailAddress: "owner@example.test" },
      }),
    },
  }),
}));
import {
  beginOAuth,
  completeOAuth,
  connectedClient,
  disconnect,
} from "../src/modules/gmail/oauth";

let directory: string;
beforeAll(() => {
  const created = testDatabase();
  state.database = created.database;
  directory = created.directory;
}, 30000);
afterAll(async () => {
  await state.database?.$disconnect();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "file:./unused.db");
  vi.stubEnv("APP_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  await state.database!.gmailAccount.deleteMany();
  await state.database!.oAuthAttempt.deleteMany();
  vi.spyOn(OAuth2Client.prototype, "getToken").mockImplementation(
    (async () => ({
      tokens: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
      },
      res: null,
    })) as OAuth2Client["getToken"],
  );
  vi.spyOn(OAuth2Client.prototype, "getTokenInfo").mockResolvedValue({
    scopes: [GMAIL_SCOPE],
    expiry_date: Date.now() + 3600000,
    aud: "synthetic-client",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("OAuth lifecycle with mocked Google responses", () => {
  it("generates only read-only scope, PKCE and encrypted expiring state", async () => {
    const result = await beginOAuth();
    const url = new URL(result.url);
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const attempt = await state.database!.oAuthAttempt.findUniqueOrThrow({
      where: { stateHash: sha256(result.state) },
    });
    const verifier = decrypt(attempt.encryptedVerifier);
    expect(attempt.encryptedVerifier).not.toContain(verifier);
    expect(attempt.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it("connects the verified profile, encrypts the token and consumes state once", async () => {
    const { state: oauthState } = await beginOAuth();
    await completeOAuth("synthetic-code", oauthState, oauthState);
    const account = await state.database!.gmailAccount.findFirstOrThrow();
    expect(account.email).toBe("owner@example.test");
    expect(account.encryptedRefreshToken).not.toContain("synthetic-refresh");
    expect(decrypt(account.encryptedRefreshToken!)).toBe("synthetic-refresh");
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "synthetic-code",
        codeVerifier: expect.any(String),
      }),
    );
    await expect(
      completeOAuth("synthetic-code", oauthState, oauthState),
    ).rejects.toThrow("OAUTH_STATE_EXPIRED");
  });
  it("rejects mismatched and expired state before exchanging a code", async () => {
    const { state: oauthState } = await beginOAuth();
    await expect(
      completeOAuth("synthetic-code", oauthState, "wrong-cookie"),
    ).rejects.toThrow("INVALID_OAUTH_STATE");
    await state.database!.oAuthAttempt.updateMany({
      data: { expiresAt: new Date(0) },
    });
    await expect(
      completeOAuth("synthetic-code", oauthState, oauthState),
    ).rejects.toThrow("OAUTH_STATE_EXPIRED");
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });
  it("rejects overbroad granted scopes without storing an account", async () => {
    vi.mocked(OAuth2Client.prototype.getTokenInfo).mockResolvedValue({
      scopes: [GMAIL_SCOPE, "https://www.googleapis.com/auth/gmail.modify"],
      expiry_date: Date.now(),
      aud: "synthetic-client",
    });
    const { state: oauthState } = await beginOAuth();
    await expect(
      completeOAuth("synthetic-code", oauthState, oauthState),
    ).rejects.toThrow("UNEXPECTED_OAUTH_SCOPE");
    expect(await state.database!.gmailAccount.count()).toBe(0);
  });
  it("requires a refresh token and leaves the user disconnected on failure", async () => {
    vi.mocked(OAuth2Client.prototype.getToken).mockImplementation(
      (async () => ({
        tokens: { access_token: "synthetic-access" },
        res: null,
      })) as OAuth2Client["getToken"],
    );
    const { state: oauthState } = await beginOAuth();
    await expect(
      completeOAuth("synthetic-code", oauthState, oauthState),
    ).rejects.toThrow("REFRESH_TOKEN_REQUIRED");
    expect(await state.database!.gmailAccount.count()).toBe(0);
  });
  it("disconnects previous accounts and deletes local tokens and pending state", async () => {
    await state.database!.gmailAccount.create({
      data: {
        email: "old@example.test",
        encryptedRefreshToken: encrypt("old-synthetic"),
        scope: GMAIL_SCOPE,
      },
    });
    const { state: oauthState } = await beginOAuth();
    await completeOAuth("synthetic-code", oauthState, oauthState);
    expect(
      (
        await state.database!.gmailAccount.findUniqueOrThrow({
          where: { email: "old@example.test" },
        })
      ).encryptedRefreshToken,
    ).toBeNull();
    expect((await connectedClient()).account.email).toBe("owner@example.test");
    await beginOAuth();
    await disconnect();
    expect(await state.database!.oAuthAttempt.count()).toBe(0);
    expect(
      await state.database!.gmailAccount.count({
        where: { encryptedRefreshToken: { not: null } },
      }),
    ).toBe(0);
    await expect(connectedClient()).rejects.toThrow("GMAIL_NOT_CONNECTED");
  });
});
