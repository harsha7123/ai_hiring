import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres() connects lazily, so importing this during `next build` without a DB is safe.
const url = process.env.DATABASE_URL;
if (!url && process.env.NEXT_PHASE !== "phase-production-build") {
  console.warn("DATABASE_URL is not set");
}

// Reuse one pool across hot reloads in development.
const g = globalThis as unknown as { __sql?: postgres.Sql };
export const sql =
  g.__sql ??
  postgres(url ?? "postgres://localhost/unset", {
    max: Number(process.env.DB_POOL_SIZE ?? 10),
    ssl: process.env.DATABASE_SSL === "true" ? "require" : undefined,
  });
if (process.env.NODE_ENV !== "production") g.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
