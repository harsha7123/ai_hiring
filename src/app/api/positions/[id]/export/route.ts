import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { AuthError, requireAction } from "@/lib/auth/guard";

// Prefix cells that spreadsheets would evaluate as formulas.
const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(_: Request, { params }: RouteContext<"/api/positions/[id]/export">) {
  let ctx;
  try {
    ctx = await requireAction("viewer");
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const { id } = await params;
  const [p] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, id), eq(schema.positions.orgId, ctx.org.id)));
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.positionId, id), inArray(schema.candidates.stage, ["shortlisted", "reserve"])))
    .orderBy(sql`${schema.candidates.finalRank} asc nulls last`);
  const header = ["rank", "status", "name", "email", "phone", "recommendation", "cv_score", "interview_score", "final_score"];
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [r.finalRank, r.stage, r.name, r.email, r.phone, r.recommendation, r.cvScore, r.interviewScore, r.finalScore].map(cell).join(","),
    ),
  );
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "position.exported", target: id });
  const safeTitle = p.title.replace(/[^\w-]+/g, "_").slice(0, 60);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shortlist_${safeTitle}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
