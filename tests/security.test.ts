import { describe, expect, it, vi } from "vitest";
import { readEnv, GMAIL_SCOPE } from "../src/modules/security/env";
import { decrypt, encrypt } from "../src/modules/security/crypto";
import { validateOAuthState, validateScope } from "../src/modules/gmail/oauth";
import { protectRequest } from "../src/modules/security/http";
import { safeLog } from "../src/modules/security/errors";
import {
  boundedQuery,
  matchesSource,
  metadata,
  querySchema,
} from "../src/modules/gmail/contracts";
import { withBackoff } from "../src/modules/gmail/client";
import { syntheticMessage } from "./fixtures/messages";

const env = {
  DATABASE_URL: "file:./test.db",
  APP_ENCRYPTION_KEY: "ab".repeat(32),
};
describe("security and boundaries", () => {
  it("retries Gmail rate-limit 403 responses and caps retries", async () => {
    let calls = 0;
    const quotaError = {
      response: {
        status: 403,
        data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
      },
    };
    const result = await withBackoff(
      async () => {
        if (calls++ === 0) throw quotaError;
        return "success";
      },
      async () => {},
    );
    expect(result).toBe("success");
    expect(calls).toBe(2);
    calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw { response: { status: 503 } };
        },
        async () => {},
      ),
    ).rejects.toThrow("GMAIL_REQUEST_FAILED");
    expect(calls).toBe(5);
  });
  it("validates local configuration and disables raw retention and AI", () => {
    expect(readEnv(env).GMAIL_SCOPE).toBe(GMAIL_SCOPE);
    for (const patch of [
      { APP_ENCRYPTION_KEY: "bad" },
      { STORE_RAW_EMAILS: "true" },
      { STORE_RAW_ATTACHMENTS: "true" },
      { AI_EXTRACTION_ENABLED: "true" },
      { APP_BASE_URL: "https://example.com" },
      { GMAIL_SCOPE: "https://mail.google.com/" },
    ])
      expect(() => readEnv({ ...env, ...patch })).toThrow();
  });
  it("encrypts tokens with randomized authenticated encryption", () => {
    const first = encrypt("synthetic-refresh-token", env.APP_ENCRYPTION_KEY);
    expect(first).not.toContain("synthetic-refresh-token");
    expect(encrypt("synthetic-refresh-token", env.APP_ENCRYPTION_KEY)).not.toBe(
      first,
    );
    expect(decrypt(first, env.APP_ENCRYPTION_KEY)).toBe(
      "synthetic-refresh-token",
    );
    expect(() => decrypt(first, "cd".repeat(32))).toThrow();
  });
  it("rejects missing/mismatched OAuth state and broader scopes", () => {
    expect(() => validateOAuthState("state", undefined)).toThrow();
    expect(() => validateOAuthState("state", "other")).toThrow();
    expect(() => validateOAuthState("state", "state")).not.toThrow();
    expect(() => validateScope(GMAIL_SCOPE)).not.toThrow();
    expect(() =>
      validateScope(
        `${GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify`,
      ),
    ).toThrow();
  });
  it("blocks hostile hosts and cross-site writes but allows OAuth callback state validation", () => {
    expect(() =>
      protectRequest(
        new Request("http://localhost:3000/api/gmail/import", {
          method: "POST",
          headers: { host: "localhost:3000", origin: "https://evil.test" },
        }),
      ),
    ).toThrow("SAME_ORIGIN_REQUIRED");
    expect(() =>
      protectRequest(
        new Request("http://localhost:3000/api/auth/status", {
          headers: { host: "evil.test" },
        }),
      ),
    ).toThrow("LOCAL_HOST_REQUIRED");
    expect(() =>
      protectRequest(
        new Request("http://localhost:3000/api/auth/google/callback", {
          headers: { host: "localhost:3000", "sec-fetch-site": "cross-site" },
        }),
      ),
    ).not.toThrow();
  });
  it("logs codes only, never arbitrary error contents", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    safeLog("secret token=123");
    expect(log).toHaveBeenCalledWith('{"event":"INTERNAL_ERROR"}');
    log.mockRestore();
  });
  it("uses Unix seconds and validates date order", () => {
    expect(
      boundedQuery(
        querySchema.parse({
          query: "research",
          after: "2026-01-01",
          before: "2026-02-01",
        }),
      ),
    ).toBe("research after:1767225600 before:1769904000");
    expect(() =>
      querySchema.parse({
        query: "research",
        after: "2026-02-01",
        before: "2026-01-01",
      }),
    ).toThrow();
  });
  it("requires sender, literal subject and date matches", () => {
    const message = metadata(syntheticMessage());
    const source = {
      acceptedSenders: ["research@example.test"],
      subjectPatterns: ["Axis research"],
      after: "2026-01-01",
      before: "2026-02-01",
    };
    expect(matchesSource(message, source)).toBe(true);
    expect(
      matchesSource({ ...message, from: "attacker@example.test" }, source),
    ).toBe(false);
    expect(matchesSource(message, { ...source, subjectPatterns: [".*"] })).toBe(
      false,
    );
  });
  it("retries throttling exponentially and stops on authorization errors", async () => {
    let attempt = 0;
    const delays: number[] = [];
    expect(
      await withBackoff(
        async () => {
          if (attempt++ < 3) throw { response: { status: 429 } };
          return "ok";
        },
        async (delay) => {
          delays.push(delay);
        },
      ),
    ).toBe("ok");
    expect(delays).toEqual([250, 500, 1000]);
    await expect(
      withBackoff(async () => {
        throw { response: { status: 403 } };
      }),
    ).rejects.toThrow("GMAIL_ACCESS_DENIED_RECONNECT");
  });
});
