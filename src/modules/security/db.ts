import { PrismaClient } from "@prisma/client";

const globalDb = globalThis as unknown as { recolabDb?: PrismaClient };
export const db = globalDb.recolabDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.recolabDb = db;
