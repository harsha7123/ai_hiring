/**
 * The screening pipeline: every stage is a durable job or a scheduler step.
 * setup -> parse -> score (1000 -> N) -> invite/consent -> call -> assess -> rerank -> shortlist
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql as dsql } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import type { PositionConfig } from "@/db/schema";
import { extractText } from "@/lib/extract";
import { knockoutReason, lexicalScore } from "@/lib/lexical";
import { redactForScoring } from "@/lib/redact";
import * as ai from "@/lib/ai/tasks";
import { enqueue } from "@/lib/jobs/queue";
import { randomToken } from "@/lib/crypto";
import { sendInvite, toE164 } from "@/lib/messaging";
import {
  dispatchCall,
  listCallLogs,
  parseCallResult,
  phoneKey,
  resolveOmnidimKey,
  type CallResult,
} from "@/lib/omnidim";
import { audit } from "@/lib/audit";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
/** Below this lexical coverage a CV is filtered out before any model call. */
const LEXICAL_FLOOR = Number(process.env.LEXICAL_FLOOR ?? 15);
const MAX_CALL_ATTEMPTS = 3;
const MAX_INVITES = 3;

async function getPosition(id: string) {
  const [p] = await db.select().from(schema.positions).where(eq(schema.positions.id, id));
  if (!p) throw new Error(`Position ${id} not found`);
  return p;
}

async function getCandidate(id: string) {
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, id));
  return c ?? null;
}

async function setCandidate(id: string, values: Partial<typeof schema.candidates.$inferInsert>) {
  await db.update(schema.candidates).set({ ...values, updatedAt: new Date() }).where(eq(schema.candidates.id, id));
}

// ---------- Setup ----------

export async function runExtractSpec({ positionId }: { positionId: string }) {
  const p = await getPosition(positionId);
  try {
    const spec = await ai.extractSpec(p.jdText);
    await db.update(schema.positions).set({ spec, specError: null }).where(eq(schema.positions.id, positionId));
  } catch (err) {
    await db
      .update(schema.positions)
      .set({ specError: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.positions.id, positionId));
    throw err;
  }
}

/** Called when the recruiter confirms the spec: score everything already parsed. */
export async function queueScoringForPosition(positionId: string, orgId: string) {
  const rows = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.positionId, positionId), eq(schema.candidates.stage, "parsed")));
  for (const r of rows) await enqueue("score_cv", { candidateId: r.id }, { orgId });
}

// ---------- Stage 1: CV parsing and ranking ----------

export async function runParseCv({ candidateId }: { candidateId: string }) {
  const c = await getCandidate(candidateId);
  if (!c || !c.fileData) return;
  try {
    let text = await extractText(c.fileData, c.fileMime);
    if (!text) text = await ai.ocrDocument(c.fileData, c.fileMime); // scanned PDF / image
    if (!text || text.trim().length < 100) throw new Error("No readable text found in this CV");
    const profile = await ai.structureProfile(text);
    await setCandidate(candidateId, {
      cvText: text,
      profile,
      name: profile.name,
      email: profile.email,
      phone: toE164(profile.phone) ?? profile.phone,
      stage: "parsed",
      error: null,
    });
    const p = await getPosition(c.positionId);
    if (p.specConfirmed) await enqueue("score_cv", { candidateId }, { orgId: c.orgId });
  } catch (err) {
    await setCandidate(candidateId, { stage: "failed", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function runScoreCv({ candidateId }: { candidateId: string }) {
  const c = await getCandidate(candidateId);
  if (!c?.cvText || !["parsed", "failed", "scored", "filtered_out"].includes(c.stage)) return;
  const p = await getPosition(c.positionId);
  if (!p.spec) return;
  const lex = lexicalScore(c.cvText, p.spec);
  const knockout = knockoutReason(c.cvText, c.profile?.totalYears ?? null, p.config);
  if (knockout || lex < LEXICAL_FLOOR) {
    await setCandidate(candidateId, {
      lexicalScore: lex,
      stage: "filtered_out",
      stageReason: knockout ?? `Low requirement match (${lex}%) in fast semantic pass`,
      cvScore: null,
    });
    return;
  }
  try {
    const { assessment, score } = await ai.assessCv(redactForScoring(c.cvText, c.name), p.spec);
    await setCandidate(candidateId, { lexicalScore: lex, assessment, cvScore: score, stage: "scored", stageReason: null, error: null });
  } catch (err) {
    await setCandidate(candidateId, { stage: "failed", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// ---------- Stage 2: selection, consent and scheduling ----------

/**
 * Advance the top-ranked CVs into the interview stage. Promoted candidates go first;
 * candidates the recruiter rejected are never selected.
 */
export async function selectForInterview(positionId: string, orgId: string, userId: string): Promise<number> {
  const p = await getPosition(positionId);
  const [{ n: already }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.interviews)
    .where(eq(schema.interviews.positionId, positionId));
  const room = Math.max(0, p.interviewPool - already);
  if (!room) return 0;
  const picks = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.positionId, positionId), inArray(schema.candidates.stage, ["scored"])))
    .orderBy(desc(schema.candidates.promoted), dsql`${schema.candidates.cvScore} desc nulls last`)
    .limit(room);
  for (const { id } of picks) await selectCandidate(id, orgId, positionId);
  if (picks.length) {
    await db.update(schema.positions).set({ status: "interviewing" }).where(eq(schema.positions.id, positionId));
  }
  await audit({ orgId, userId, action: "position.select_for_interview", target: positionId, meta: { count: picks.length } });
  return picks.length;
}

export async function selectCandidate(candidateId: string, orgId: string, positionId: string) {
  await setCandidate(candidateId, { stage: "selected", inviteToken: randomToken(24) });
  await db
    .insert(schema.interviews)
    .values({ orgId, candidateId, positionId, status: "queued" })
    .onConflictDoNothing({ target: schema.interviews.candidateId });
  await enqueue("design_questions", { candidateId }, { orgId });
  await enqueue("send_invite", { candidateId }, { orgId });
}

export async function runDesignQuestions({ candidateId }: { candidateId: string }) {
  const c = await getCandidate(candidateId);
  if (!c?.cvText) return;
  const p = await getPosition(c.positionId);
  if (!p.spec) return;
  const questions = await ai.designQuestions({
    redactedCv: redactForScoring(c.cvText, c.name),
    spec: p.spec,
    assessment: c.assessment,
    customQuestions: p.config.customQuestions,
  });
  await db.update(schema.interviews).set({ questions }).where(eq(schema.interviews.candidateId, candidateId));
}

export function inviteLink(token: string) {
  return `${appUrl()}/i/${token}`;
}

export async function runSendInvite({ candidateId }: { candidateId: string }) {
  const c = await getCandidate(candidateId);
  if (!c?.inviteToken || c.consentAt || !["selected", "invited"].includes(c.stage)) return;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, c.orgId));
  const p = await getPosition(c.positionId);
  const first = c.name?.split(" ")[0] ?? "there";
  const body = `Hi ${first}, thanks for applying to ${org.name} for the ${p.title} role. The first round is a short (about 10 min) AI-conducted voice interview. Choose a time or take the call now: ${inviteLink(c.inviteToken)}`;
  const phone = toE164(c.phone);
  const result = phone ? await sendInvite(phone, body) : { sent: false, error: "No valid phone number" };
  await setCandidate(candidateId, {
    stage: "invited",
    inviteAttempts: c.inviteAttempts + 1,
    lastInvitedAt: new Date(),
    error: result.sent ? null : `Invite not sent automatically: ${result.error}. Share the link manually.`,
  });
}

/** Candidate response from the consent page. */
export async function recordConsent(opts: {
  token: string;
  choice: "now" | "schedule" | "human";
  scheduledAt?: Date;
  ip: string | null;
  consentText: string;
}) {
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.inviteToken, opts.token));
  if (!c || !["selected", "invited", "consented"].includes(c.stage)) throw new Error("This invitation is no longer active.");
  if (opts.choice === "human") {
    await setCandidate(c.id, { stage: "declined", wantsHuman: true, stageReason: "Declined AI round; requested a human interviewer" });
    await db.update(schema.interviews).set({ status: "cancelled" }).where(eq(schema.interviews.candidateId, c.id));
    await audit({ orgId: c.orgId, action: "candidate.requested_human", target: c.id, ip: opts.ip });
    return;
  }
  const when = opts.choice === "now" ? new Date() : opts.scheduledAt!;
  await setCandidate(c.id, { stage: "consented", consentAt: new Date(), consentIp: opts.ip, consentText: opts.consentText, error: null });
  await db
    .update(schema.interviews)
    .set({ status: "queued", nextAttemptAt: when, lastError: null })
    .where(eq(schema.interviews.candidateId, c.id));
  await audit({ orgId: c.orgId, action: "candidate.consented", target: c.id, ip: opts.ip, meta: { choice: opts.choice, when: when.toISOString() } });
}

// ---------- Stage 3: AI voice interview ----------

const TZ_OFFSET_MIN = Number(process.env.APP_TZ_OFFSET_MINUTES ?? 330); // IST

/** Move a retry into calling hours (09:30-20:00 local), spread across times of day. */
export function nextCallSlot(from: Date, delayHours: number): Date {
  const t = new Date(from.getTime() + delayHours * 3600_000);
  const local = new Date(t.getTime() + TZ_OFFSET_MIN * 60_000);
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (h >= 9.5 && h < 20) return t;
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (h >= 20 ? 1 : 0), 10, 0));
  return new Date(day.getTime() - TZ_OFFSET_MIN * 60_000);
}

export async function dispatchDueInterviews() {
  const due = await db
    .select({ interview: schema.interviews, candidate: schema.candidates, position: schema.positions, org: schema.organizations })
    .from(schema.interviews)
    .innerJoin(schema.candidates, eq(schema.candidates.id, schema.interviews.candidateId))
    .innerJoin(schema.positions, eq(schema.positions.id, schema.interviews.positionId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.interviews.orgId))
    .where(
      and(
        eq(schema.interviews.status, "queued"),
        lt(schema.interviews.nextAttemptAt, new Date()),
        eq(schema.candidates.stage, "consented"),
      ),
    )
    .orderBy(asc(schema.interviews.nextAttemptAt))
    .limit(20);

  for (const { interview: iv, candidate: c, position: p, org } of due) {
    const fail = (msg: string, retryInMin = 10) =>
      db
        .update(schema.interviews)
        .set({ lastError: msg, nextAttemptAt: new Date(Date.now() + retryInMin * 60_000) })
        .where(eq(schema.interviews.id, iv.id));

    if (!iv.questions) {
      await fail("Waiting for interview questions to be generated", 1);
      continue;
    }
    // Hard spend cap per role: total dials, including retries.
    const [{ dials }] = await db
      .select({ dials: dsql<number>`coalesce(sum(${schema.interviews.attempts}), 0)::int` })
      .from(schema.interviews)
      .where(eq(schema.interviews.positionId, p.id));
    if (dials >= p.maxInterviews) {
      await fail(`Spend cap reached (${p.maxInterviews} calls for this role). Raise the cap to continue.`, 60);
      continue;
    }
    const apiKey = resolveOmnidimKey(org);
    if (!apiKey || !org.omnidimAgentId) {
      // Graceful degradation: interviews wait in the queue until voice is configured.
      await fail("Voice calling is not configured. Add the OmniDimension key and agent in Settings.", 15);
      continue;
    }
    const phone = toE164(c.phone);
    if (!phone) {
      await db.update(schema.interviews).set({ status: "failed", lastError: "Candidate has no valid phone number" }).where(eq(schema.interviews.id, iv.id));
      continue;
    }
    // Claim the row first so two schedulers can never dial the same candidate.
    const claimed = await db
      .update(schema.interviews)
      .set({ status: "dispatched", dispatchedAt: new Date(), attempts: iv.attempts + 1, lastError: null })
      .where(and(eq(schema.interviews.id, iv.id), eq(schema.interviews.status, "queued")))
      .returning({ id: schema.interviews.id });
    if (!claimed.length) continue;
    try {
      const { requestId } = await dispatchCall(apiKey, {
        agentId: org.omnidimAgentId,
        toNumber: phone,
        fromNumberId: org.omnidimFromNumberId,
        callContext: {
          candidate_name: c.name?.split(" ")[0] ?? "there",
          company_name: org.name,
          role_title: p.title,
          role_summary: `${p.spec?.summary ?? ""} Location: ${p.spec?.location ?? p.location ?? "not specified"}.`.trim(),
          questions: iv.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n"),
          interview_id: iv.id,
        },
        metadata: { interview_id: iv.id, org_id: org.id },
      });
      await db.update(schema.interviews).set({ omnidimRequestId: requestId }).where(eq(schema.interviews.id, iv.id));
    } catch (err) {
      await handleCallFailure(iv.id, err instanceof Error ? err.message : String(err));
    }
  }
}

async function handleCallFailure(interviewId: string, reason: string) {
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.id, interviewId));
  if (!iv) return;
  if (iv.attempts < MAX_CALL_ATTEMPTS) {
    // Retry at a different time of day: +3h, then +20h.
    const delay = iv.attempts === 1 ? 3 : 20;
    await db
      .update(schema.interviews)
      .set({ status: "queued", nextAttemptAt: nextCallSlot(new Date(), delay), lastError: reason })
      .where(eq(schema.interviews.id, interviewId));
  } else {
    await db.update(schema.interviews).set({ status: "no_answer", lastError: reason }).where(eq(schema.interviews.id, interviewId));
    await setCandidate(iv.candidateId, { stage: "unreachable", stageReason: `No completed call after ${iv.attempts} attempts` });
  }
}

/** Idempotent: webhook and poller may both deliver the same call. */
export async function applyCallResult(interviewId: string, r: CallResult) {
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.id, interviewId));
  if (!iv || iv.status !== "dispatched") return;
  if (r.status === "in_progress") return;
  if (r.status === "completed" && (r.transcript?.length ?? 0) >= 80) {
    await db
      .update(schema.interviews)
      .set({
        status: "completed",
        completedAt: new Date(),
        transcript: r.transcript,
        recordingUrl: r.recordingUrl,
        durationSec: r.durationSec,
        summary: r.summary,
        omnidimCallLogId: r.callLogId,
      })
      .where(eq(schema.interviews.id, interviewId));
    if (r.wantsHuman) {
      await setCandidate(iv.candidateId, { wantsHuman: true, stage: "declined", stageReason: "Asked for a human interviewer during the call" });
      return;
    }
    await enqueue("assess_interview", { interviewId }, { orgId: iv.orgId });
    return;
  }
  await handleCallFailure(interviewId, r.status === "completed" ? "Call ended before the interview started" : `Call ${r.status.replace("_", " ")}`);
}

/** Fallback when webhooks are delayed or blocked: reconcile with OmniDimension call logs. */
export async function syncDispatchedCalls() {
  const pending = await db
    .select({ interview: schema.interviews, candidate: schema.candidates, org: schema.organizations })
    .from(schema.interviews)
    .innerJoin(schema.candidates, eq(schema.candidates.id, schema.interviews.candidateId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.interviews.orgId))
    .where(and(eq(schema.interviews.status, "dispatched"), lt(schema.interviews.dispatchedAt, new Date(Date.now() - 90_000))));
  const byOrg = new Map<string, typeof pending>();
  for (const row of pending) byOrg.set(row.org.id, [...(byOrg.get(row.org.id) ?? []), row]);

  for (const rows of byOrg.values()) {
    const org = rows[0].org;
    const key = resolveOmnidimKey(org);
    if (!key || !org.omnidimAgentId) continue;
    let logs;
    try {
      logs = (await listCallLogs(key, org.omnidimAgentId)).map(parseCallResult);
    } catch (err) {
      console.error("call log sync failed", err);
      continue;
    }
    for (const { interview: iv, candidate: c } of rows) {
      const match = logs.find(
        (l) =>
          phoneKey(l.toNumber) === phoneKey(c.phone) &&
          (!l.timeOfCall || l.timeOfCall.getTime() >= (iv.dispatchedAt?.getTime() ?? 0) - 5 * 60_000) &&
          l.status !== "in_progress",
      );
      if (match) await applyCallResult(iv.id, match);
      else if (iv.dispatchedAt && Date.now() - iv.dispatchedAt.getTime() > 45 * 60_000) {
        await handleCallFailure(iv.id, "No call result received within 45 minutes");
      }
    }
  }
}

/** Stage 2 retry: re-send unanswered invitations at different times of day, then give up. */
export async function retryInvites() {
  const stale = await db
    .select()
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.stage, "invited"),
        isNull(schema.candidates.consentAt),
        lt(schema.candidates.lastInvitedAt, new Date(Date.now() - 7 * 3600_000)),
      ),
    )
    .limit(100);
  for (const c of stale) {
    if (c.inviteAttempts >= MAX_INVITES) {
      if (c.lastInvitedAt && Date.now() - c.lastInvitedAt.getTime() > 24 * 3600_000) {
        await setCandidate(c.id, { stage: "unreachable", stageReason: `No response to ${c.inviteAttempts} invitations` });
        await db.update(schema.interviews).set({ status: "cancelled" }).where(eq(schema.interviews.candidateId, c.id));
      }
      continue;
    }
    await enqueue("send_invite", { candidateId: c.id }, { orgId: c.orgId, runAt: nextCallSlot(new Date(), 0) });
    // Bump the timestamp now so the next tick does not enqueue a duplicate.
    await setCandidate(c.id, { lastInvitedAt: new Date() });
  }
}

// ---------- Stage 4: assessment, re-ranking and reports ----------

export async function runAssessInterview({ interviewId }: { interviewId: string }) {
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.id, interviewId));
  if (!iv?.transcript) return;
  const c = await getCandidate(iv.candidateId);
  if (!c?.cvText) return;
  const p = await getPosition(iv.positionId);
  if (!p.spec) return;
  const result = await ai.assessInterview({
    transcript: iv.transcript,
    redactedCv: redactForScoring(c.cvText, c.name),
    spec: p.spec,
    questions: iv.questions ?? [],
  });
  const final = combinedScore(c.cvScore, result.score, p.config);
  await db.update(schema.interviews).set({ assessment: result.assessment }).where(eq(schema.interviews.id, interviewId));
  await db
    .insert(schema.reports)
    .values({ candidateId: c.id, orgId: c.orgId, content: result.report, model: result.model })
    .onConflictDoUpdate({ target: schema.reports.candidateId, set: { content: result.report, model: result.model, createdAt: new Date() } });
  await setCandidate(c.id, {
    interviewScore: result.score,
    finalScore: final,
    recommendation: result.report.recommendation,
    stage: c.stage === "rejected" ? "rejected" : "interviewed",
  });
  await rerankPosition(p.id);
}

export function combinedScore(cv: number | null, interview: number, config: PositionConfig) {
  const w = Math.min(1, Math.max(0, config.cvWeight));
  return Math.round(((cv ?? 0) * w + interview * (1 - w)) * 10) / 10;
}

/** Top N become the shortlist; the rest remain visible as a reserve pool. */
export async function rerankPosition(positionId: string) {
  const p = await getPosition(positionId);
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; cv_score: number | null; interview_score: number; promoted: boolean }[]>`
      select id, cv_score, interview_score, promoted from candidates
      where position_id = ${positionId} and stage in ('interviewed', 'shortlisted', 'reserve')
        and interview_score is not null
      for update`;
    const ranked = rows
      .map((r) => ({ id: r.id, promoted: r.promoted, score: combinedScore(r.cv_score, r.interview_score, p.config) }))
      // Recruiter promotions outrank the model's ordering.
      .sort((a, b) => Number(b.promoted) - Number(a.promoted) || b.score - a.score);
    for (const [i, r] of ranked.entries()) {
      const stage = i < p.targetShortlist ? "shortlisted" : "reserve";
      await tx`update candidates set final_rank = ${i + 1}, final_score = ${r.score}, stage = ${stage}, updated_at = now() where id = ${r.id}`;
    }
  });
}

// ---------- Retention (DPDP) ----------

export async function applyRetention() {
  const orgs = await db.select().from(schema.organizations);
  for (const org of orgs) {
    const recCutoff = new Date(Date.now() - org.settings.retentionRecordingDays * 864e5);
    const recordCutoff = new Date(Date.now() - org.settings.retentionRecordDays * 864e5);
    await db
      .update(schema.interviews)
      .set({ recordingUrl: null })
      .where(and(eq(schema.interviews.orgId, org.id), lt(schema.interviews.completedAt, recCutoff)));
    const purged = await db
      .delete(schema.candidates)
      .where(and(eq(schema.candidates.orgId, org.id), lt(schema.candidates.createdAt, recordCutoff)))
      .returning({ id: schema.candidates.id });
    if (purged.length) await audit({ orgId: org.id, action: "retention.purged_candidates", meta: { count: purged.length } });
  }
}
