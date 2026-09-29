import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage } from "@/lib/auth/guard";
import { Card, Empty, PageHeader, td, th } from "@/components/ui";
import { fmtDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const ctx = await requirePage("admin");
  const rows = await db
    .select({ log: schema.auditLogs, userName: schema.users.name })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
    .where(eq(schema.auditLogs.orgId, ctx.org.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(300);
  return (
    <>
      <PageHeader title="Audit log" description="Sign-ins, configuration changes, candidate decisions, consent and deletions. Latest 300 events." />
      <Card>
        {rows.length === 0 ? (
          <Empty title="No events yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Actor</th>
                  <th className={th}>Event</th>
                  <th className={th}>Target</th>
                  <th className={th}>IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ log, userName }) => (
                  <tr key={log.id}>
                    <td className={`${td} whitespace-nowrap text-ink-3`}>{fmtDate(log.createdAt)}</td>
                    <td className={td}>{userName ?? (log.action.startsWith("candidate.") ? "Candidate" : "System")}</td>
                    <td className={`${td} font-mono text-xs`}>{log.action}</td>
                    <td className={`${td} max-w-[200px] truncate font-mono text-xs text-ink-3`}>{log.target ?? ""}</td>
                    <td className={`${td} text-xs text-ink-3`}>{log.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
