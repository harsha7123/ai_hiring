import { db, schema } from "@/db";

export async function audit(entry: {
  orgId?: string | null;
  userId?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await db.insert(schema.auditLogs).values({
      orgId: entry.orgId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      target: entry.target ?? null,
      meta: entry.meta ?? null,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    console.error("audit log write failed", err);
  }
}
