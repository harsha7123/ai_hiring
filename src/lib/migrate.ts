import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "@/db";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Apply pending migrations once, even when several instances boot together.
 *
 * This deliberately does not use drizzle-orm's own `migrate()` helper. That
 * helper always opens its own internal transaction, so it can't be nested
 * inside one of ours — and a lock that isn't held in the exact same
 * transaction as the migration SQL gives no real guarantee behind a
 * transaction-mode pooler (e.g. Supabase's Supavisor pooler on port 6543,
 * which Render needs since the direct-connection host is IPv6-only). Such
 * poolers only pin one physical backend to a client for the lifetime of an
 * explicit transaction; a lock and the work it's meant to guard, if split
 * across two separate statements/transactions, can each land on a different
 * backend — the session-scoped lock a naive pg_advisory_lock/unlock pair
 * takes is a well-documented no-op for cross-process coordination there.
 *
 * So instead: one `BEGIN ... COMMIT`, everything inside it — a transaction-
 * scoped advisory lock (auto-released at commit, no separate unlock to ever
 * mismatch) and the same handful of statements drizzle's migrator would run,
 * replicated directly against that one transaction's connection. Reads the
 * same migration files and writes the same tracking table drizzle's own
 * `migrate()` uses, so it stays a drop-in for anyone inspecting the database.
 */
export async function runMigrations() {
  const migrations = readMigrationFiles({ migrationsFolder: path.join(process.cwd(), "drizzle") });

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727200)`;
    await tx`create schema if not exists ${tx(MIGRATIONS_SCHEMA)}`;
    await tx`
      create table if not exists ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )`;
    const [lastDbMigration] = await tx`
      select created_at from ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)}
      order by created_at desc limit 1`;

    for (const migration of migrations) {
      if (lastDbMigration && Number(lastDbMigration.created_at) >= migration.folderMillis) continue;
      for (const stmt of migration.sql) await tx.unsafe(stmt);
      await tx`
        insert into ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)} (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})`;
    }
  });
}
