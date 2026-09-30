"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { RequirementSpec } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AuthError, requireAction, type Ctx } from "@/lib/auth/guard";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs/queue";
import { createInterviewAgent, resolveOmnidimKey, testKey } from "@/lib/omnidim";
import { queueScoringForPosition, rerankPosition, selectCandidate, selectForInterview } from "@/lib/pipeline";
import type { FormState } from "@/components/client";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
const optNum = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const int = (v: FormDataEntryValue | null, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Wraps an action so auth and validation failures come back as a form error. */
function guarded(fn: (fd: FormData) => Promise<FormState | void>) {
  return async (_: FormState, fd: FormData): Promise<FormState> => {
    try {
      return (await fn(fd)) ?? undefined;
    } catch (err) {
      if (err instanceof AuthError) return { error: err.message };
      if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
      console.error(err);
      return { error: err instanceof Error ? err.message : "Something went wrong" };
    }
  };
}

async function ownPosition(ctx: Ctx, id: string) {
  const [p] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, id), eq(schema.positions.orgId, ctx.org.id)));
  if (!p) throw new AuthError("Role not found");
  return p;
}

async function ownCandidate(ctx: Ctx, id: string) {
  const [c] = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, id), eq(schema.candidates.orgId, ctx.org.id)));
  if (!c) throw new AuthError("Candidate not found");
  return c;
}

const refresh = () => revalidatePath("/app", "layout");

// ---------- Roles ----------

export const createPosition = guarded(async (fd) => {
  const ctx = await requireAction("recruiter");
  const data = z
    .object({
      title: z.string().trim().min(2, "Enter a role title").max(150),
      location: z.string().trim().max(150).optional(),
      jdText: z.string().trim().min(200, "Paste the full job description (at least 200 characters)").max(60_000),
    })
    .parse(Object.fromEntries(fd));
  const [p] = await db
    .insert(schema.positions)
    .values({
      orgId: ctx.org.id,
      title: data.title,
      location: data.location || null,
      jdText: data.jdText,
      targetShortlist: int(fd.get("targetShortlist"), 1, 500, 20),
      interviewPool: int(fd.get("interviewPool"), 1, 2000, 200),
      maxInterviews: int(fd.get("maxInterviews"), 1, 5000, 250),
      config: { cvWeight: 0.4, minYears: null, mandatoryKeywords: [], customQuestions: [] },
      createdBy: ctx.user.id,
    })
    .returning({ id: schema.positions.id });
  await enqueue("extract_spec", { positionId: p.id }, { orgId: ctx.org.id });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "position.created", target: p.id });
  redirect(`/app/positions/${p.id}?tab=requirements`);
});

export const saveSpec = guarded(async (fd) => {
  const ctx = await requireAction("recruiter");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  const spec: RequirementSpec = {
    summary: String(fd.get("summary") ?? "").trim().slice(0, 1000),
    mustHave: lines(fd.get("mustHave")),
    niceToHave: lines(fd.get("niceToHave")),
    minYears: optNum(fd.get("minYears")),
    maxYears: optNum(fd.get("maxYears")),
    qualifications: lines(fd.get("qualifications")),
    location: String(fd.get("location") ?? "").trim() || null,
    shift: String(fd.get("shift") ?? "").trim() || null,
  };
  if (!spec.mustHave.length) return { error: "Add at least one must-have skill." };
  const confirm = fd.get("confirm") === "1";
  await db
    .update(schema.positions)
    .set({ spec, specConfirmed: confirm || p.specConfirmed, status: p.status === "draft" && confirm ? "screening" : p.status })
    .where(eq(schema.positions.id, p.id));
  if (confirm || p.specConfirmed) {
    // Re-score everything already assessed so the ranking reflects the new spec.
    await db
      .update(schema.candidates)
      .set({ stage: "parsed" })
      .where(and(eq(schema.candidates.positionId, p.id), inArray(schema.candidates.stage, ["scored", "filtered_out"])));
    await queueScoringForPosition(p.id, ctx.org.id);
  }
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: confirm ? "position.spec_confirmed" : "position.spec_saved", target: p.id });
  refresh();
  return { ok: confirm ? "Requirements confirmed. CVs are being scored." : "Saved." };
});

export async function retrySpec(fd: FormData) {
  const ctx = await requireAction("recruiter");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  await db.update(schema.positions).set({ specError: null }).where(eq(schema.positions.id, p.id));
  await enqueue("extract_spec", { positionId: p.id }, { orgId: ctx.org.id });
  refresh();
}

export const savePositionConfig = guarded(async (fd) => {
  const ctx = await requireAction("recruiter");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  const config = {
    cvWeight: int(fd.get("cvWeight"), 0, 100, 40) / 100,
    minYears: optNum(fd.get("minYears")),
    mandatoryKeywords: lines(fd.get("mandatoryKeywords")),
    customQuestions: String(fd.get("customQuestions") ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5),
  };
  const knockoutsChanged =
    config.minYears !== p.config.minYears || config.mandatoryKeywords.join("|") !== p.config.mandatoryKeywords.join("|");
  await db
    .update(schema.positions)
    .set({
      title: String(fd.get("title") ?? p.title).trim().slice(0, 150) || p.title,
      config,
      targetShortlist: int(fd.get("targetShortlist"), 1, 500, p.targetShortlist),
      interviewPool: int(fd.get("interviewPool"), 1, 2000, p.interviewPool),
      maxInterviews: int(fd.get("maxInterviews"), 1, 5000, p.maxInterviews),
    })
    .where(eq(schema.positions.id, p.id));
  if (knockoutsChanged && p.specConfirmed) {
    await db
      .update(schema.candidates)
      .set({ stage: "parsed" })
      .where(and(eq(schema.candidates.positionId, p.id), inArray(schema.candidates.stage, ["scored", "filtered_out"])));
    await queueScoringForPosition(p.id, ctx.org.id);
  }
  await rerankPosition(p.id);
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "position.config_updated", target: p.id, meta: config });
  refresh();
  return { ok: "Settings saved." };
});

export const startInterviews = guarded(async (fd) => {
  const ctx = await requireAction("recruiter");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  if (!p.specConfirmed) return { error: "Confirm the requirements first." };
  const n = await selectForInterview(p.id, ctx.org.id, ctx.user.id);
  refresh();
  return n ? { ok: `${n} candidates selected. Invitations are being sent.` } : { error: "No scored candidates are waiting, or the interview pool is full." };
});

export async function setPositionStatus(fd: FormData) {
  const ctx = await requireAction("admin");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  const status = z.enum(["screening", "completed", "archived"]).parse(fd.get("status"));
  await db.update(schema.positions).set({ status }).where(eq(schema.positions.id, p.id));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: `position.${status}`, target: p.id });
  refresh();
}

export async function deletePosition(fd: FormData) {
  const ctx = await requireAction("admin");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  await db.delete(schema.positions).where(eq(schema.positions.id, p.id));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "position.deleted", target: p.id, meta: { title: p.title } });
  redirect("/app");
}

export async function retryFailed(fd: FormData) {
  const ctx = await requireAction("recruiter");
  const p = await ownPosition(ctx, String(fd.get("positionId")));
  const failed = await db
    .select({ id: schema.candidates.id, cvText: schema.candidates.cvText })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.positionId, p.id), eq(schema.candidates.stage, "failed")));
  for (const c of failed) {
    if (c.cvText) {
      await db.update(schema.candidates).set({ stage: "parsed", error: null }).where(eq(schema.candidates.id, c.id));
      await enqueue("score_cv", { candidateId: c.id }, { orgId: ctx.org.id });
    } else {
      await db.update(schema.candidates).set({ stage: "uploaded", error: null }).where(eq(schema.candidates.id, c.id));
      await enqueue("parse_cv", { candidateId: c.id }, { orgId: ctx.org.id });
    }
  }
  refresh();
}

// ---------- Candidates (human override) ----------

export async function promoteCandidate(fd: FormData) {
  const ctx = await requireAction("recruiter");
  const c = await ownCandidate(ctx, String(fd.get("candidateId")));
  if (["parsed", "scored", "filtered_out", "rejected"].includes(c.stage) && c.cvText) {
    await db.update(schema.candidates).set({ promoted: true, stageReason: "Promoted by recruiter" }).where(eq(schema.candidates.id, c.id));
    await selectCandidate(c.id, ctx.org.id, c.positionId);
  } else if (c.stage === "reserve") {
    await db.update(schema.candidates).set({ promoted: true }).where(eq(schema.candidates.id, c.id));
    await rerankPosition(c.positionId);
  }
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "candidate.promoted", target: c.id, meta: { from: c.stage } });
  refresh();
}

export async function rejectCandidate(fd: FormData) {
  const ctx = await requireAction("recruiter");
  const c = await ownCandidate(ctx, String(fd.get("candidateId")));
  await db
    .update(schema.candidates)
    .set({ stage: "rejected", promoted: false, stageReason: "Rejected by recruiter", finalRank: null })
    .where(eq(schema.candidates.id, c.id));
  await db
    .update(schema.interviews)
    .set({ status: "cancelled" })
    .where(and(eq(schema.interviews.candidateId, c.id), eq(schema.interviews.status, "queued")));
  await rerankPosition(c.positionId);
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "candidate.rejected", target: c.id, meta: { from: c.stage } });
  refresh();
}

export async function resendInvite(fd: FormData) {
  const ctx = await requireAction("recruiter");
  const c = await ownCandidate(ctx, String(fd.get("candidateId")));
  if (!["selected", "invited", "unreachable"].includes(c.stage)) return;
  await db
    .update(schema.candidates)
    .set({ stage: "invited", inviteAttempts: 0, inviteToken: c.inviteToken ?? randomToken(24) })
    .where(eq(schema.candidates.id, c.id));
  await enqueue("send_invite", { candidateId: c.id }, { orgId: ctx.org.id });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "candidate.invite_resent", target: c.id });
  refresh();
}

/** Record a human-run or externally-run interview so it flows through the same scoring. */
export const submitTranscript = guarded(async (fd) => {
  const ctx = await requireAction("recruiter");
  const c = await ownCandidate(ctx, String(fd.get("candidateId")));
  const transcript = String(fd.get("transcript") ?? "").trim();
  if (transcript.length < 200) return { error: "Paste the full transcript (at least 200 characters)." };
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.candidateId, c.id));
  if (!iv) return { error: "Select this candidate for interview first." };
  await db
    .update(schema.interviews)
    .set({ status: "completed", transcript: transcript.slice(0, 100_000), completedAt: new Date(), lastError: null })
    .where(eq(schema.interviews.id, iv.id));
  await enqueue("assess_interview", { interviewId: iv.id }, { orgId: ctx.org.id });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "interview.transcript_submitted", target: c.id });
  refresh();
  return { ok: "Transcript saved. The report is being generated." };
});

/** DPDP deletion request: removes CV, transcript, recording link and derived scores. */
export async function deleteCandidate(fd: FormData) {
  const ctx = await requireAction("admin");
  const c = await ownCandidate(ctx, String(fd.get("candidateId")));
  await db.delete(schema.candidates).where(eq(schema.candidates.id, c.id));
  await rerankPosition(c.positionId);
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "candidate.deleted", target: c.id });
  redirect(`/app/positions/${c.positionId}?tab=candidates`);
}

// ---------- Organisation settings ----------

export const updateOrg = guarded(async (fd) => {
  const ctx = await requireAction("admin");
  const name = String(fd.get("name") ?? "").trim().slice(0, 100);
  if (name.length < 2) return { error: "Enter an organisation name." };
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, ctx.org.id));
  await db
    .update(schema.organizations)
    .set({
      name,
      settings: {
        ...org.settings,
        retentionRecordingDays: int(fd.get("retentionRecordingDays"), 7, 3650, 90),
        retentionRecordDays: int(fd.get("retentionRecordDays"), 30, 3650, 180),
      },
    })
    .where(eq(schema.organizations.id, ctx.org.id));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "org.updated" });
  refresh();
  return { ok: "Saved." };
});

export const saveVoice = guarded(async (fd) => {
  const ctx = await requireAction("admin");
  const apiKey = String(fd.get("apiKey") ?? "").trim();
  const agentId = optNum(fd.get("agentId"));
  const fromNumberId = optNum(fd.get("fromNumberId"));
  if (apiKey) {
    try {
      await testKey(apiKey);
    } catch (err) {
      return { error: `OmniDimension rejected the key: ${err instanceof Error ? err.message : err}` };
    }
  }
  await db
    .update(schema.organizations)
    .set({
      ...(apiKey ? { omnidimApiKeyEnc: encrypt(apiKey) } : {}),
      omnidimAgentId: agentId,
      omnidimFromNumberId: fromNumberId,
    })
    .where(eq(schema.organizations.id, ctx.org.id));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "org.voice_updated", meta: { keyChanged: !!apiKey, agentId, fromNumberId } });
  refresh();
  return { ok: "Voice settings saved." };
});

export async function clearVoiceKey() {
  const ctx = await requireAction("admin");
  await db.update(schema.organizations).set({ omnidimApiKeyEnc: null }).where(eq(schema.organizations.id, ctx.org.id));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "org.voice_key_removed" });
  refresh();
}

export const provisionAgent = guarded(async () => {
  const ctx = await requireAction("admin");
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, ctx.org.id));
  const key = resolveOmnidimKey(org);
  if (!key) return { error: "Add an OmniDimension API key first (or set OMNIDIM_API_KEY on the server)." };
  const webhookUrl = `${appUrl()}/api/webhooks/omnidim/${org.webhookSecret}`;
  if (!/^https:\/\//.test(webhookUrl) && process.env.NODE_ENV === "production") {
    return { error: "APP_URL must be a public https:// address so OmniDimension can deliver call results." };
  }
  const agentId = await createInterviewAgent(key, { orgName: org.name, webhookUrl });
  await db.update(schema.organizations).set({ omnidimAgentId: agentId }).where(eq(schema.organizations.id, org.id));
  await audit({ orgId: org.id, userId: ctx.user.id, action: "org.voice_agent_created", meta: { agentId } });
  refresh();
  return { ok: `Interview agent #${agentId} created and connected.` };
});

export async function rotateWebhookSecret() {
  const ctx = await requireAction("owner");
  await db.update(schema.organizations).set({ webhookSecret: randomToken(24) }).where(eq(schema.organizations.id, ctx.org.id));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "org.webhook_rotated" });
  refresh();
}

// ---------- Team ----------

export const inviteMember = guarded(async (fd) => {
  const ctx = await requireAction("admin");
  const email = z.string().trim().toLowerCase().email("Enter a valid email").parse(fd.get("email"));
  const role = z.enum(["admin", "recruiter", "viewer"]).parse(fd.get("role"));
  if (role === "admin" && ctx.role !== "owner") return { error: "Only the owner can invite admins." };
  const token = randomToken();
  await db.insert(schema.invites).values({
    orgId: ctx.org.id,
    email,
    role,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 7 * 864e5),
    createdBy: ctx.user.id,
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "member.invited", meta: { email, role } });
  refresh();
  return { ok: `Invite link (valid 7 days, share it privately): ${appUrl()}/invite/${token}` };
});

export async function revokeInvite(fd: FormData) {
  const ctx = await requireAction("admin");
  await db
    .delete(schema.invites)
    .where(and(eq(schema.invites.id, String(fd.get("inviteId"))), eq(schema.invites.orgId, ctx.org.id), isNull(schema.invites.acceptedAt)));
  refresh();
}

export async function removeMember(fd: FormData) {
  const ctx = await requireAction("admin");
  const userId = String(fd.get("userId"));
  if (userId === ctx.user.id) return;
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.orgId, ctx.org.id)));
  if (!m || m.role === "owner" || (m.role === "admin" && ctx.role !== "owner")) return;
  // Deleting the membership is enough: the next page load for that user finds this
  // organisation missing from their list (see readSession), which revokes access to
  // it immediately without touching their Supabase session or other workspaces.
  await db.delete(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.orgId, ctx.org.id)));
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "member.removed", target: userId });
  refresh();
}
