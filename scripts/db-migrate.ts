import nextEnv from "@next/env";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

nextEnv.loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("file:"))
  throw new Error("DATABASE_URL must be a SQLite file URL");
const databasePath = resolve("prisma", databaseUrl.slice(5));
mkdirSync(dirname(databasePath), { recursive: true });
closeSync(openSync(databasePath, "a", 0o600));
const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
