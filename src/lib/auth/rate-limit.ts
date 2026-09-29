import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * DB-backed limiter built on audit rows, so it holds across multiple app instances.
 * Returns true when the caller is over the limit.
 */
export async function tooManyFailures(opts: { email: string; ip: string | null }): Promise<boolean> {
  const since = new Date(Date.now() - 15 * 60_000);
  const failed = and(eq(schema.auditLogs.action, "auth.login_failed"), gt(schema.auditLogs.createdAt, since));
  const [byEmail] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditLogs)
    .where(and(failed, sql`${schema.auditLogs.meta}->>'email' = ${opts.email}`));
  if (byEmail.n >= 5) return true;
  if (!opts.ip) return false;
  const [byIp] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditLogs)
    .where(and(failed, eq(schema.auditLogs.ip, opts.ip)));
  return byIp.n >= 25;
}
