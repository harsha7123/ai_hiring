import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";

export async function loadPosition(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, id), eq(schema.positions.orgId, orgId)));
  if (!p) notFound();
  return p;
}

export async function loadCandidates(orgId: string, positionId: string) {
  return db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      fileName: schema.candidates.fileName,
      phone: schema.candidates.phone,
      stage: schema.candidates.stage,
      stageReason: schema.candidates.stageReason,
      lexicalScore: schema.candidates.lexicalScore,
      cvScore: schema.candidates.cvScore,
      interviewScore: schema.candidates.interviewScore,
      finalScore: schema.candidates.finalScore,
      finalRank: schema.candidates.finalRank,
      recommendation: schema.candidates.recommendation,
      promoted: schema.candidates.promoted,
      wantsHuman: schema.candidates.wantsHuman,
      error: schema.candidates.error,
      inviteToken: schema.candidates.inviteToken,
      inviteAttempts: schema.candidates.inviteAttempts,
      consentAt: schema.candidates.consentAt,
      interviewStatus: schema.interviews.status,
      interviewAttempts: schema.interviews.attempts,
      nextAttemptAt: schema.interviews.nextAttemptAt,
      interviewError: schema.interviews.lastError,
      hasQuestions: sql<boolean>`${schema.interviews.questions} is not null`,
    })
    .from(schema.candidates)
    .leftJoin(schema.interviews, eq(schema.interviews.candidateId, schema.candidates.id))
    .where(and(eq(schema.candidates.positionId, positionId), eq(schema.candidates.orgId, orgId)))
    .orderBy(
      sql`${schema.candidates.finalRank} asc nulls last`,
      sql`${schema.candidates.cvScore} desc nulls last`,
      desc(schema.candidates.createdAt),
    );
}

export type CandidateRow = Awaited<ReturnType<typeof loadCandidates>>[number];
export type PositionRow = Awaited<ReturnType<typeof loadPosition>>;

export function funnel(rows: CandidateRow[]) {
  const count = (f: (r: CandidateRow) => boolean) => rows.filter(f).length;
  const post = ["selected", "invited", "consented", "declined", "interviewed", "unreachable", "shortlisted", "reserve"];
  return {
    applied: rows.length,
    screened: count((r) => r.cvScore != null || r.stage === "filtered_out"),
    selected: count((r) => post.includes(r.stage) || (r.stage === "rejected" && r.interviewStatus != null)),
    consented: count((r) => r.consentAt != null),
    interviewed: count((r) => r.interviewScore != null),
    shortlisted: count((r) => r.stage === "shortlisted"),
    drop: {
      filtered: count((r) => r.stage === "filtered_out"),
      failed: count((r) => r.stage === "failed"),
      declined: count((r) => r.stage === "declined"),
      unreachable: count((r) => r.stage === "unreachable"),
      rejected: count((r) => r.stage === "rejected"),
    },
  };
}

/** Whether background work is in flight, so the page should keep refreshing. */
export function isBusy(p: PositionRow, rows: CandidateRow[]) {
  if (!p.spec && !p.specError) return true;
  return rows.some(
    (r) =>
      r.stage === "uploaded" ||
      (r.stage === "parsed" && p.specConfirmed) ||
      (r.stage === "selected" && !r.hasQuestions) ||
      r.interviewStatus === "dispatched" ||
      (r.interviewStatus === "completed" && r.interviewScore == null),
  );
}
