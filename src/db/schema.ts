import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  bigserial,
  primaryKey,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const memberRole = pgEnum("member_role", ["owner", "admin", "recruiter", "viewer"]);

export const positionStatus = pgEnum("position_status", [
  "draft",
  "screening",
  "interviewing",
  "completed",
  "archived",
]);

export const candidateStage = pgEnum("candidate_stage", [
  "uploaded",
  "parsed",
  "filtered_out",
  "scored",
  "selected",
  "invited",
  "consented",
  "declined",
  "interviewed",
  "unreachable",
  "shortlisted",
  "reserve",
  "rejected",
  "failed",
]);

export const interviewStatus = pgEnum("interview_status", [
  "queued",
  "dispatched",
  "completed",
  "no_answer",
  "failed",
  "cancelled",
]);

export const jobStatus = pgEnum("job_status", ["pending", "running", "done", "failed"]);

export type OrgSettings = {
  retentionRecordingDays: number;
  retentionRecordDays: number;
  consentText?: string;
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  settings: jsonb("settings").$type<OrgSettings>().notNull(),
  omnidimApiKeyEnc: text("omnidim_api_key_enc"),
  omnidimAgentId: integer("omnidim_agent_id"),
  omnidimFromNumberId: integer("omnidim_from_number_id"),
  webhookSecret: text("webhook_secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Mirrors Supabase's auth.users: id is the Supabase auth user id (no default —
// it is always set explicitly from the authenticated session), never a locally
// generated one. Supabase owns credentials and sessions; this table just holds
// the profile fields the app needs to join against organisations/roles.
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

// Which organisation a signed-in user is currently viewing (a user can belong to
// several). Supabase owns the actual session/cookie; this just remembers the
// last-selected tenant per browser via a small first-party cookie, keyed here
// only for the "switch organisation" picker default.
export const activeOrgPrefs = pgTable("active_org_prefs", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: memberRole("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RequirementSpec = {
  summary: string;
  mustHave: string[];
  niceToHave: string[];
  minYears: number | null;
  maxYears: number | null;
  qualifications: string[];
  location: string | null;
  shift: string | null;
};

export type PositionConfig = {
  cvWeight: number; // 0..1, interview weight = 1 - cvWeight
  minYears: number | null; // knockout
  mandatoryKeywords: string[]; // knockout (e.g. certification)
  customQuestions: string[];
};

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    location: text("location"),
    jdText: text("jd_text").notNull(),
    spec: jsonb("spec").$type<RequirementSpec>(),
    specConfirmed: boolean("spec_confirmed").notNull().default(false),
    specError: text("spec_error"),
    config: jsonb("config").$type<PositionConfig>().notNull(),
    targetShortlist: integer("target_shortlist").notNull().default(20),
    interviewPool: integer("interview_pool").notNull().default(200),
    maxInterviews: integer("max_interviews").notNull().default(250), // hard spend cap
    status: positionStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("positions_org_idx").on(t.orgId)],
);

export type Evidence = { quote: string; source: "cv" | "transcript" };

export type CvProfile = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  totalYears: number | null;
  currentTitle: string | null;
  employment: { title: string; company: string; start: string | null; end: string | null }[];
  skills: { name: string; years: number | null }[];
  education: string[];
  gaps: string[];
};

export type CvAssessment = {
  dimensions: { name: string; score: number; rationale: string; evidence: string[] }[];
  mustHaveCoverage: { skill: string; present: boolean; evidence: string | null }[];
  summary: string;
  knockout: string | null;
};

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    fileName: text("file_name").notNull(),
    fileMime: text("file_mime").notNull(),
    fileData: bytea("file_data"),
    cvText: text("cv_text"),
    profile: jsonb("profile").$type<CvProfile>(),
    assessment: jsonb("assessment").$type<CvAssessment>(),
    stage: candidateStage("stage").notNull().default("uploaded"),
    stageReason: text("stage_reason"),
    lexicalScore: real("lexical_score"),
    cvScore: real("cv_score"),
    interviewScore: real("interview_score"),
    finalScore: real("final_score"),
    finalRank: integer("final_rank"),
    recommendation: text("recommendation"),
    promoted: boolean("promoted").notNull().default(false),
    inviteToken: text("invite_token").unique(),
    inviteAttempts: integer("invite_attempts").notNull().default(0),
    lastInvitedAt: timestamp("last_invited_at", { withTimezone: true }),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentIp: text("consent_ip"),
    consentText: text("consent_text"),
    wantsHuman: boolean("wants_human").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("candidates_position_idx").on(t.positionId, t.stage),
    index("candidates_org_idx").on(t.orgId),
  ],
);

export type InterviewQuestion = { question: string; purpose: string };

export type InterviewAssessment = {
  dimensions: { name: string; score: number; rationale: string; evidence: string[] }[];
  skillVerification: { skill: string; claimedOnCv: boolean; probed: boolean; substantiated: "yes" | "partly" | "no" | "not_probed"; evidence: string | null }[];
  logistics: { noticePeriod: string | null; compensation: string | null; location: string | null; shiftWillingness: string | null };
};

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    status: interviewStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    questions: jsonb("questions").$type<InterviewQuestion[]>(),
    omnidimRequestId: text("omnidim_request_id"),
    omnidimCallLogId: text("omnidim_call_log_id"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    transcript: text("transcript"),
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    assessment: jsonb("assessment").$type<InterviewAssessment>(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interviews_status_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("interviews_candidate_uq").on(t.candidateId),
  ],
);

export type ReportContent = {
  recommendation: "strong_fit" | "fit" | "borderline" | "not_recommended";
  summary: string;
  strengths: { title: string; detail: string; evidence: Evidence }[];
  concerns: { title: string; detail: string; evidence: Evidence }[];
  noConcernsStatement: string | null;
  suggestedProbes: string[];
  droppedUnsupportedClaims: number;
};

export const reports = pgTable("reports", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  content: jsonb("content").$type<ReportContent>().notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_pending_idx").on(t.status, t.runAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt), index("audit_action_idx").on(t.action, t.createdAt)],
);
