import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { testDatabase } from "./database";
import { syntheticMessage } from "./fixtures/messages";
import { storeMessage, saveSource } from "../src/modules/gmail/ingestion";
import type { GmailGateway } from "../src/modules/gmail/client";

async function main() {
  const { database, directory } = testDatabase();
  const gateway: GmailGateway = {
    accountEmail: "owner@example.test",
    async list() {
      return { messages: [{ id: "synthetic-1" }], resultSizeEstimate: 1 };
    },
    async get() {
      return syntheticMessage();
    },
    async attachment() {
      return "";
    },
  };
  const source = await saveSource(
    {
      provider: "Axis Direct",
      query: "Synthetic",
      acceptedSenders: ["research@example.test"],
      subjectPatterns: ["Axis research"],
      confirmed: true,
    },
    gateway,
    database,
  );
  await storeMessage(syntheticMessage(), source.id, gateway, false, database);
  await database.$disconnect();
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "localhost",
      "--port",
      "3100",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: `file:${directory}/test.db`,
        APP_BASE_URL: "http://localhost:3100",
        GOOGLE_REDIRECT_URI: "http://localhost:3100/api/auth/google/callback",
        APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        GOOGLE_CLIENT_ID: "synthetic-client",
        GOOGLE_CLIENT_SECRET: "synthetic-secret",
        AI_EXTRACTION_ENABLED: "false",
        STORE_RAW_EMAILS: "false",
        STORE_RAW_ATTACHMENTS: "false",
      },
    },
  );
  let stopping = false;
  function stop() {
    if (!stopping) {
      stopping = true;
      child.kill("SIGTERM");
    }
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  child.on("exit", (code) => {
    rmSync(directory, { recursive: true, force: true });
    process.exit(code ?? 0);
  });
}
void main();
