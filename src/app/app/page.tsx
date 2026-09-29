import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { can, requirePage } from "@/lib/auth/guard";
import { Badge, ButtonLink, Card, Empty, PageHeader, td, th } from "@/components/ui";
import { fmtDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Roles" };

const STATUS_TONE = { draft: "neutral", screening: "info", interviewing: "info", completed: "good", archived: "neutral" } as const;

export default async function Dashboard() {
  const ctx = await requirePage();
  const positions = await db
    .select({
      id: schema.positions.id,
      title: schema.positions.title,
      location: schema.positions.location,
      status: schema.positions.status,
      target: schema.positions.targetShortlist,
      createdAt: schema.positions.createdAt,
      total: sql<number>`(select count(*)::int from candidates c where c.position_id = ${schema.positions.id})`,
      ranked: sql<number>`(select count(*)::int from candidates c where c.position_id = ${schema.positions.id} and c.cv_score is not null)`,
      interviewed: sql<number>`(select count(*)::int from candidates c where c.position_id = ${schema.positions.id} and c.interview_score is not null)`,
      shortlisted: sql<number>`(select count(*)::int from candidates c where c.position_id = ${schema.positions.id} and c.stage = 'shortlisted')`,
    })
    .from(schema.positions)
    .where(eq(schema.positions.orgId, ctx.org.id))
    .orderBy(desc(schema.positions.createdAt));

  const active = positions.filter((p) => p.status !== "archived");
  const archived = positions.filter((p) => p.status === "archived");

  return (
    <>
      <PageHeader
        title="Roles"
        description="Each role runs its own screening funnel, from CV pile to ranked shortlist."
        actions={can(ctx.role, "recruiter") && <ButtonLink href="/app/positions/new">New role</ButtonLink>}
      />
      <Card>
        {active.length === 0 ? (
          <Empty title="No roles yet">Create a role, paste the job description, then upload the CV pile.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Role</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>CVs</th>
                  <th className={`${th} text-right`}>Ranked</th>
                  <th className={`${th} text-right`}>Interviewed</th>
                  <th className={`${th} text-right`}>Shortlist</th>
                  <th className={th}>Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {active.map((p) => (
                  <tr key={p.id} className="hover:bg-sunken/50">
                    <td className={td}>
                      <Link href={`/app/positions/${p.id}`} className="font-medium text-ink hover:underline">
                        {p.title}
                      </Link>
                      {p.location && <div className="text-xs text-ink-3">{p.location}</div>}
                    </td>
                    <td className={td}>
                      <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                    </td>
                    <td className={`${td} tabular text-right`}>{p.total}</td>
                    <td className={`${td} tabular text-right`}>{p.ranked}</td>
                    <td className={`${td} tabular text-right`}>{p.interviewed}</td>
                    <td className={`${td} tabular text-right`}>
                      {p.shortlisted}
                      <span className="text-ink-3"> / {p.target}</span>
                    </td>
                    <td className={`${td} text-ink-3`}>{fmtDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {archived.length > 0 && (
        <p className="mt-6 text-sm text-ink-3">
          Archived:{" "}
          {archived.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/app/positions/${p.id}`} className="underline-offset-4 hover:underline">
                {p.title}
              </Link>
            </span>
          ))}
        </p>
      )}
    </>
  );
}
