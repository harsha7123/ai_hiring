import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "@/db";

/** Apply pending migrations once, even when several instances boot together. */
export async function runMigrations() {
  const conn = await sql.reserve();
  try {
    await conn`select pg_advisory_lock(727200)`;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await conn`select pg_advisory_unlock(727200)`;
    conn.release();
  }
}
