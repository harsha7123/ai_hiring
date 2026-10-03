/**
 * The screening pipeline: every stage is a durable job or a scheduler step.
 * setup -> parse -> score (1000 -> N) -> invite/consent -> interview -> assess -> rerank -> shortlist
 */
import { and, asc, eq, inArray, isNull, lt, sql as dsql } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import type { CvProfile, OrgSettings, PositionConfig } from "@/db/schema";
import { extractText } from "@/lib/extract";
import { knockoutReason, lexicalScore } from "@/lib/lexical";
import { redactForScoring } from "@/lib/redact";
import * as ai from "@/lib/ai/tasks";
import { enqueue } from "@/lib/jobs/queue";
import { randomToken } from "@/lib/crypto";
import { sendInvite, toE164 } from "@/lib/messaging";
import { isValidEmail, sendEmail } from "@/lib/email";
import { createWebSession, dispatchCall, listCallLogs, parseCallResult, phoneKey, resolveOmnidimKey, type CallResult } from "@/lib/omnidim";
import { audit } from "@/lib/audit";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
/** Below this lexical coverage a CV is filtered out before any model call. */
const LEXICAL_FLOOR = Number(process.env.LEXICAL_FLOOR ?? 15);
const MAX_INVITES = 3;
const MAX_CALL_ATTEMPTS = 3;
/** A session the candidate never finished (closed tab, lost connection) this long ago is abandoned. */
const STALE_SESSION_MS = 2 * 3600_000;
/** IST (UTC+5:30) — this app's calling-hours window (org.settings.callWindow*) is always local India time. */
const TZ_OFFSET_MIN = 330;

const fmtHour = (h: number) => (h === 0 || h === 24 ? "12am" : h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`);

function callWindow(settings: OrgSettings): { startHour: number; endHour: number } {
  const startHour = Number.isFinite(settings.callWindowStartHour) ? settings.callWindowStartHour : 9;
  const endHour = Number.isFinite(settings.callWindowEndHour) ? settings.callWindowEndHour : 18;
  return { startHour, endHour };
}

/** Next IST moment at or after `from` that falls inside the org's calling-hours window. */
function nextCallSlot(from: Date, settings: OrgSettings): Date {
  const { startHour, endHour } = callWindow(settings);
  const local = new Date(from.getTime() + TZ_OFFSET_MIN * 60_000);
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (h >= startHour && h < endHour) return from;
  const dayOffset = h >= endHour ? 1 : 0;
  const nextLocalStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, startHour, 0));
  return new Date(nextLocalStart.getTime() - TZ_OFFSET_MIN * 60_000);
}

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
    const phone = toE164(profile.phone) ?? profile.phone;
    const cvDocumentId = await upsertCvDocument(c.orgId, { ...c, cvText: text, profile, name: profile.name, email: profile.email, phone });
    await setCandidate(candidateId, {
      cvText: text,
      profile,
      name: profile.name,
      email: profile.email,
      phone,
      cvDocumentId,
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

/**
 * Keeps the org-wide CV library in sync with a freshly parsed CV. Deduped by
 * email so the same person uploaded to five different roles over the years
 * still counts as one library entry, always holding their latest CV. Returns
 * null for a CV with no email — there's nothing reliable to dedupe it on, so
 * it isn't added to the shared pool (it still screens fine for its own role).
 */
async function upsertCvDocument(
  orgId: string,
  doc: { name: string | null; email: string | null; phone: string | null; fileName: string; fileMime: string; fileData: Buffer | null; cvText: string; profile: CvProfile },
): Promise<string | null> {
  if (!doc.email) return null;
  const values = {
    orgId,
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    fileName: doc.fileName,
    fileMime: doc.fileMime,
    fileData: doc.fileData,
    cvText: doc.cvText,
    profile: doc.profile,
  };
  const [row] = await db
    .insert(schema.cvDocuments)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.cvDocuments.orgId, schema.cvDocuments.email],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: schema.cvDocuments.id });
  return row.id;
}

/**
 * Pulls every CV already in the company's library (uploaded to any other role)
 * that isn't already a candidate on this position, and runs it through this
 * role's screening too. Only meaningful once the role's spec is confirmed.
 */
export async function matchPoolToPosition(positionId: string, orgId: string): Promise<number> {
  const p = await getPosition(positionId);
  if (p.orgId !== orgId) throw new Error("Role not found");
  const existing = await db
    .select({ cvDocumentId: schema.candidates.cvDocumentId })
    .from(schema.candidates)
    .where(eq(schema.candidates.positionId, positionId));
  const already = new Set(existing.map((r) => r.cvDocumentId).filter((id): id is string => id != null));
  const pool = await db.select().from(schema.cvDocuments).where(eq(schema.cvDocuments.orgId, orgId));
  const toAdd = pool.filter((d) => !already.has(d.id));
  for (const d of toAdd) {
    const [c] = await db
      .insert(schema.candidates)
      .values({
        orgId,
        positionId,
        cvDocumentId: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        fileName: d.fileName,
        fileMime: d.fileMime,
        fileData: d.fileData,
        cvText: d.cvText,
        profile: d.profile,
        stage: d.cvText ? "parsed" : "uploaded",
      })
      .returning({ id: schema.candidates.id });
    if (d.cvText) await enqueue("score_cv", { candidateId: c.id }, { orgId });
    else await enqueue("parse_cv", { candidateId: c.id }, { orgId });
  }
  return toAdd.length;
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

// ---------- Stage 2: selection, consent ----------

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
    .orderBy(dsql`${schema.candidates.promoted} desc, ${schema.candidates.cvScore} desc nulls last`)
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
  const link = inviteLink(c.inviteToken);
  const body =
    p.interviewMode === "phone_call"
      ? (() => {
          const { startHour, endHour } = callWindow(org.settings);
          return `Hi ${first}, thanks for applying to ${org.name} for the ${p.title} role. The first round is a short (about 10 min) AI phone interview. Please confirm you're ready here, and we'll call you between ${fmtHour(startHour)} and ${fmtHour(endHour)}: ${link}`;
        })()
      : `Hi ${first}, thanks for applying to ${org.name} for the ${p.title} role. The first round is a short (about 10 min) AI interview you take right from your phone or computer browser, whenever you're ready: ${link}`;

  const emailResult = isValidEmail(c.email)
    ? await sendEmail(c.email, `Your interview for ${p.title} at ${org.name}`, body)
    : { sent: false, error: "No valid email on file" };
  const phone = toE164(c.phone);
  const smsResult = phone ? await sendInvite(phone, body) : { sent: false, error: "No valid phone number" };

  const sent = emailResult.sent || smsResult.sent;
  await setCandidate(candidateId, {
    stage: "invited",
    inviteAttempts: c.inviteAttempts + 1,
    lastInvitedAt: new Date(),
    error: sent ? null : `Invite not sent automatically (email: ${emailResult.error}; SMS: ${smsResult.error}). Share the link manually.`,
  });
}

/**
 * Candidate consents on the invite page. For an in-browser role this happens
 * immediately before the browser connects; for a phone-call role, consenting
 * here just puts the candidate in the outbound-calling queue — the actual call
 * is placed later (within calling hours) by dispatchDueInterviews.
 */
export async function recordConsent(opts: { token: string; ip: string | null; consentText: string }): Promise<{ mode: "in_browser" | "phone_call" }> {
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.inviteToken, opts.token));
  if (!c || !["selected", "invited", "consented"].includes(c.stage)) throw new Error("This invitation is no longer active.");
  const p = await getPosition(c.positionId);
  if (!c.consentAt) {
    await setCandidate(c.id, { stage: "consented", consentAt: new Date(), consentIp: opts.ip, consentText: opts.consentText, error: null });
    await audit({ orgId: c.orgId, action: "candidate.consented", target: c.id, ip: opts.ip });
  }
  if (p.interviewMode === "phone_call") {
    await db.update(schema.interviews).set({ status: "queued", nextAttemptAt: new Date(), lastError: null }).where(eq(schema.interviews.candidateId, c.id));
  }
  return { mode: p.interviewMode };
}

export async function recordHumanRequest(token: string, ip: string | null) {
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.inviteToken, token));
  if (!c || !["selected", "invited", "consented"].includes(c.stage)) throw new Error("This invitation is no longer active.");
  await setCandidate(c.id, { stage: "declined", wantsHuman: true, stageReason: "Declined AI round; requested a human interviewer" });
  await db.update(schema.interviews).set({ status: "cancelled" }).where(eq(schema.interviews.candidateId, c.id));
  await audit({ orgId: c.orgId, action: "candidate.requested_human", target: c.id, ip });
}

// ---------- Stage 3: AI voice interview (in-browser) ----------

/**
 * Starts (or restarts, if the candidate reloaded) the candidate's browser voice
 * session. Returns the WebSocket URL the client connects to with the
 * `@omnidim-ai/client` SDK. The candidate's own device and microphone are used —
 * no phone number or outbound call is involved.
 */
export async function startWebInterview(token: string): Promise<{ wsUrl: string }> {
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.inviteToken, token));
  if (!c || c.stage !== "consented") throw new Error("This invitation is no longer active.");
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.candidateId, c.id));
  if (!iv || iv.status === "completed" || iv.status === "cancelled") throw new Error("This interview is no longer active.");
  if (!iv.questions) throw new Error("Your interview questions are still being prepared. Please try again in a minute.");

  const [p] = await db.select().from(schema.positions).where(eq(schema.positions.id, iv.positionId));
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, iv.orgId));
  const apiKey = resolveOmnidimKey(org);
  if (!apiKey || !org.omnidimAgentId) throw new Error("Interviews are not yet configured for this organisation. Please contact the recruiter.");

  const [{ attempts: dials }] = await db
    .select({ attempts: dsql<number>`coalesce(sum(${schema.interviews.attempts}), 0)::int` })
    .from(schema.interviews)
    .where(eq(schema.interviews.positionId, p.id));
  if (dials >= p.maxInterviews) throw new Error("This role has reached its interview capacity. Please contact the recruiter.");

  const { wsUrl } = await createWebSession(apiKey, {
    agentId: org.omnidimAgentId,
    customVariables: {
      candidate_name: c.name?.split(" ")[0] ?? "there",
      company_name: org.name,
      role_title: p.title,
      role_summary: `${p.spec?.summary ?? ""} Location: ${p.spec?.location ?? p.location ?? "not specified"}.`.trim(),
      questions: iv.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n"),
    },
    metadata: { interview_id: iv.id, org_id: org.id },
  });
  await db
    .update(schema.interviews)
    .set({ status: "dispatched", dispatchedAt: new Date(), attempts: iv.attempts + 1, lastError: null })
    .where(eq(schema.interviews.id, iv.id));
  return { wsUrl };
}

/** Called by the browser once the session ends, with the transcript it captured live. */
export async function completeWebInterview(token: string, transcript: string, durationSec: number | null): Promise<void> {
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.inviteToken, token));
  if (!c) throw new Error("Invalid invitation.");
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.candidateId, c.id));
  if (!iv || iv.status !== "dispatched") return; // already completed or no longer active; ignore a duplicate post

  if (transcript.trim().length < 80) {
    await db.update(schema.interviews).set({ status: "failed", lastError: "Interview ended before it really started" }).where(eq(schema.interviews.id, iv.id));
    return;
  }
  await db
    .update(schema.interviews)
    .set({ status: "completed", completedAt: new Date(), transcript, durationSec, lastError: null })
    .where(eq(schema.interviews.id, iv.id));
  await enqueue("assess_interview", { interviewId: iv.id }, { orgId: iv.orgId });
}

/**
 * Single entry point for OmniDimension's post-call webhook, for both interview
 * modes. For a phone-call interview the webhook is the only signal that the
 * call ended, so it drives completion/retry directly (applyCallResult). For an
 * in-browser interview it is only best-effort enrichment — the browser's own
 * completion post is what actually finishes and scores the interview.
 */
export async function enrichFromWebhook(interviewId: string, r: CallResult) {
  const [row] = await db
    .select({ iv: schema.interviews, mode: schema.positions.interviewMode })
    .from(schema.interviews)
    .innerJoin(schema.positions, eq(schema.positions.id, schema.interviews.positionId))
    .where(eq(schema.interviews.id, interviewId));
  if (!row) return;
  if (row.mode === "phone_call") return applyCallResult(row.iv, r);
  const iv = row.iv;
  const patch: Partial<typeof schema.interviews.$inferInsert> = {};
  if (!iv.recordingUrl && r.recordingUrl) patch.recordingUrl = r.recordingUrl;
  if (!iv.summary && r.summary) patch.summary = r.summary;
  if (!iv.transcript && r.transcript && r.transcript.length >= 80) patch.transcript = r.transcript;
  if (Object.keys(patch).length) await db.update(schema.interviews).set(patch).where(eq(schema.interviews.id, interviewId));

  // The webhook arrived before the browser's own completion post (candidate closed
  // the tab right after hanging up, say) — finish the interview from it instead of
  // leaving it stuck in "dispatched".
  if (iv.status === "dispatched" && r.status === "completed" && (r.transcript?.length ?? iv.transcript?.length ?? 0) >= 80) {
    await completeFromResult(iv.id, iv.orgId, patch.transcript ?? iv.transcript!, r.durationSec);
  }
}

async function completeFromResult(interviewId: string, orgId: string, transcript: string, durationSec: number | null) {
  await db
    .update(schema.interviews)
    .set({ status: "completed", completedAt: new Date(), transcript, durationSec, lastError: null })
    .where(eq(schema.interviews.id, interviewId));
  await enqueue("assess_interview", { interviewId }, { orgId });
}

/** Cleans up sessions the candidate started but never finished (closed tab, lost connection). Phone calls have their own timeout in syncDispatchedCalls. */
export async function expireStaleWebSessions() {
  const stale = await db
    .select({ id: schema.interviews.id, candidateId: schema.interviews.candidateId })
    .from(schema.interviews)
    .innerJoin(schema.positions, eq(schema.positions.id, schema.interviews.positionId))
    .where(
      and(
        eq(schema.interviews.status, "dispatched"),
        eq(schema.positions.interviewMode, "in_browser"),
        lt(schema.interviews.dispatchedAt, new Date(Date.now() - STALE_SESSION_MS)),
      ),
    );
  for (const iv of stale) {
    await db
      .update(schema.interviews)
      .set({ status: "failed", lastError: "The interview was not completed (connection lost or the page was closed)" })
      .where(eq(schema.interviews.id, iv.id));
  }
}

// ---------- Stage 3b: AI voice interview (phone call) ----------

/**
 * Dials every phone-call-mode interview that's consented and due, respecting
 * the org's calling-hours window and the role's spend cap (total dials,
 * including retries). Run from the scheduler tick alongside the web-session
 * upkeep above.
 */
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
        eq(schema.positions.interviewMode, "phone_call"),
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
    const slot = nextCallSlot(new Date(), org.settings);
    if (slot.getTime() > Date.now()) {
      // Outside calling hours — park it at the next window open rather than dialling now.
      await db.update(schema.interviews).set({ nextAttemptAt: slot }).where(eq(schema.interviews.id, iv.id));
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
      await fail("Voice calling is not configured. Add the OmniDimension key and agent in Settings.", 15);
      continue;
    }
    const phone = toE164(c.phone);
    if (!phone) {
      await db.update(schema.interviews).set({ status: "failed", lastError: "Candidate has no valid phone number" }).where(eq(schema.interviews.id, iv.id));
      continue;
    }
    // Claim the row first so two scheduler ticks can never dial the same candidate.
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
      await handleCallFailure(iv.id, err instanceof Error ? err.message : String(err), org.settings);
    }
  }
}

async function handleCallFailure(interviewId: string, reason: string, settings: OrgSettings) {
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.id, interviewId));
  if (!iv) return;
  if (iv.attempts < MAX_CALL_ATTEMPTS) {
    // Retry at a different time of day: +3h, then +20h — nextCallSlot still clamps to calling hours.
    const delayHours = iv.attempts === 1 ? 3 : 20;
    await db
      .update(schema.interviews)
      .set({ status: "queued", nextAttemptAt: nextCallSlot(new Date(Date.now() + delayHours * 3600_000), settings), lastError: reason })
      .where(eq(schema.interviews.id, interviewId));
  } else {
    await db.update(schema.interviews).set({ status: "no_answer", lastError: reason }).where(eq(schema.interviews.id, interviewId));
    await setCandidate(iv.candidateId, { stage: "unreachable", stageReason: `No completed call after ${iv.attempts} attempts` });
  }
}

/** Idempotent: webhook and poller may both deliver the same call result. */
async function applyCallResult(iv: typeof schema.interviews.$inferSelect, r: CallResult) {
  if (iv.status !== "dispatched") return;
  if (r.status === "in_progress") return;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, iv.orgId));
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
      .where(eq(schema.interviews.id, iv.id));
    if (r.wantsHuman) {
      await setCandidate(iv.candidateId, { wantsHuman: true, stage: "declined", stageReason: "Asked for a human interviewer during the call" });
      return;
    }
    await enqueue("assess_interview", { interviewId: iv.id }, { orgId: iv.orgId });
    return;
  }
  await handleCallFailure(iv.id, r.status === "completed" ? "Call ended before the interview started" : `Call ${r.status.replace("_", " ")}`, org.settings);
}

/** Fallback for when a webhook is delayed or blocked: reconcile against OmniDimension's own call logs. */
export async function syncDispatchedCalls() {
  const pending = await db
    .select({ interview: schema.interviews, candidate: schema.candidates, org: schema.organizations })
    .from(schema.interviews)
    .innerJoin(schema.candidates, eq(schema.candidates.id, schema.interviews.candidateId))
    .innerJoin(schema.positions, eq(schema.positions.id, schema.interviews.positionId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.interviews.orgId))
    .where(and(eq(schema.interviews.status, "dispatched"), eq(schema.positions.interviewMode, "phone_call"), lt(schema.interviews.dispatchedAt, new Date(Date.now() - 90_000))));
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
        (l) => phoneKey(l.toNumber) === phoneKey(c.phone) && (!l.timeOfCall || l.timeOfCall.getTime() >= (iv.dispatchedAt?.getTime() ?? 0) - 5 * 60_000) && l.status !== "in_progress",
      );
      if (match) await applyCallResult(iv, match);
      else if (iv.dispatchedAt && Date.now() - iv.dispatchedAt.getTime() > 45 * 60_000) {
        await handleCallFailure(iv.id, "No call result received within 45 minutes", org.settings);
      }
    }
  }
}

/** Stage 2 retry: re-send the invite link to candidates who haven't started yet, then give up. */
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
    await enqueue("send_invite", { candidateId: c.id }, { orgId: c.orgId });
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
  await notifyNewlyShortlisted(positionId);
}

/**
 * Emails anyone who just became shortlisted for the first time (re-ranking can
 * run many times as more interviews complete, so this only ever fires once per
 * candidate — guarded by shortlistEmailSentAt, set in the same statement as the
 * send so a retry can't double-send after a partial failure).
 */
async function notifyNewlyShortlisted(positionId: string) {
  const p = await getPosition(positionId);
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, p.orgId));
  const pending = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.positionId, positionId), eq(schema.candidates.stage, "shortlisted"), isNull(schema.candidates.shortlistEmailSentAt)));
  for (const c of pending) {
    // Mark first: an email that fails to send shouldn't be retried forever if
    // the address itself is the problem, and a slow send shouldn't race the
    // next re-rank into double-sending.
    await setCandidate(c.id, { shortlistEmailSentAt: new Date() });
    if (!isValidEmail(c.email)) continue;
    const first = c.name?.split(" ")[0] ?? "there";
    const next = p.schedulingLink
      ? `The next step is a conversation with our hiring team. Please book a time that works for you here: ${p.schedulingLink}`
      : "The next step is a conversation with our hiring team — they will reach out directly to arrange a time.";
    const body = `Hi ${first}, good news — based on your application and interview, you've been shortlisted for the ${p.title} role at ${org.name}.\n\n${next}`;
    const result = await sendEmail(c.email, `You've been shortlisted for ${p.title} at ${org.name}`, body);
    if (!result.sent) console.error(`shortlist email failed for candidate ${c.id}:`, result.error);
  }
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
