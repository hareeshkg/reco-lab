import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "recolab-synthetic-"));
  const databasePath = join(directory, "test.db");
  writeFileSync(databasePath, "", { mode: 0o600 });
  const url = `file:${databasePath}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  return {
    database: new PrismaClient({ datasources: { db: { url } } }),
    directory,
  };
}
