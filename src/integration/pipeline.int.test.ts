/**
 * Integration tests: the real pipeline against a real (disposable) Postgres,
 * with the AI in deterministic demo mode and CV files stored in the database.
 *
 * Runs only when INTEGRATION_DATABASE_URL is set (CI provides a throwaway
 * Postgres service), so it can never touch a real database by accident.
 *   INTEGRATION_DATABASE_URL=postgres://... npm run test:int
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.INTEGRATION_DATABASE_URL;

if (!url) {
  it("integration tests", { skip: "INTEGRATION_DATABASE_URL is not set" }, () => {});
} else {
  // Must be set before any app module (and its database pool) is loaded.
  Object.assign(process.env, { DATABASE_URL: url, AI_DEMO_MODE: "true", CV_STORAGE: "database", APP_URL: "http://localhost:3000" });
  for (const k of ["RESEND_API_KEY", "EMAIL_FROM", "TWILIO_ACCOUNT_SID", "OMNIDIM_API_KEY", "ERROR_WEBHOOK_URL"]) delete process.env[k];

  type Mods = {
    db: typeof import("@/db");
    schema: typeof import("@/db/schema");
    pipeline: typeof import("@/lib/pipeline");
    queue: typeof import("@/lib/jobs/queue");
    rate: typeof import("@/lib/rate-limit");
    storage: typeof import("@/lib/storage");
    orm: typeof import("drizzle-orm");
  };
  let m: Mods;

  const JD = [
    "Senior Backend Engineer, payments platform. Location: Bengaluru",
    "Must have: Python, PostgreSQL, AWS and Docker, with 5+ years of experience building backend services.",
    "You will design APIs, own reliability, and mentor two engineers.",
    "Nice to have: Kafka, Kubernetes",
  ].join("\n");

  const cvText = (name: string, email: string, body: string) =>
    [name, email, "+91 98765 43210", body, "B.Tech in Computer Science, Example University", "Comfortable with on-call rotations and mentoring junior engineers across time zones."].join("\n");

  const strongCv = (name: string, email: string) =>
    cvText(name, email, "Backend engineer with 6 years of professional experience.\nBuilt Python and PostgreSQL services on AWS, packaged with Docker.\nLed a Kafka migration for payment events.");

  async function newOrg() {
    const { db, schema } = m.db;
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `Test Org ${randomUUID().slice(0, 6)}`, webhookSecret: randomUUID().replace(/-/g, ""), settings: m.schema.DEFAULT_ORG_SETTINGS })
      .returning();
    return org;
  }

  async function newPosition(orgId: string) {
    const { db, schema } = m.db;
    const [p] = await db
      .insert(schema.positions)
      .values({ orgId, title: "Senior Backend Engineer", jdText: JD, config: { cvWeight: 0.4, minYears: null, mandatoryKeywords: [], customQuestions: [] } })
      .returning();
    await m.pipeline.runExtractSpec({ positionId: p.id });
    await db.update(schema.positions).set({ specConfirmed: true, status: "screening" }).where(m.orm.eq(schema.positions.id, p.id));
    return p;
  }

  /** Same as the upload route: store the file, insert the row, then run the parse job inline. */
  async function upload(orgId: string, positionId: string, text: string) {
    const { db, schema } = m.db;
    const id = randomUUID();
    const stored = await m.storage.storeCv(orgId, "candidates", id, Buffer.from(text), "text/plain");
    await db.insert(schema.candidates).values({ id, orgId, positionId, fileName: "cv.txt", fileMime: "text/plain", ...stored });
    await m.pipeline.runParseCv({ candidateId: id });
    return id;
  }

  const candidate = async (id: string) => (await m.db.db.select().from(m.db.schema.candidates).where(m.orm.eq(m.db.schema.candidates.id, id)))[0];
  const interviewOf = async (candidateId: string) =>
    (await m.db.db.select().from(m.db.schema.interviews).where(m.orm.eq(m.db.schema.interviews.candidateId, candidateId)))[0];
  const jobsFor = (type: string, key: string, value: string) =>
    m.db.sql<{ id: number; run_at: string | Date; status: string }[]>`select id, run_at, status from jobs where type = ${type} and payload->>${key} = ${value} order by id`;

  before(async () => {
    m = {
      db: await import("@/db"),
      schema: await import("@/db/schema"),
      pipeline: await import("@/lib/pipeline"),
      queue: await import("@/lib/jobs/queue"),
      rate: await import("@/lib/rate-limit"),
      storage: await import("@/lib/storage"),
      orm: await import("drizzle-orm"),
    };
    const { runMigrations } = await import("@/lib/migrate");
    await runMigrations();
    await runMigrations(); // idempotent: a second boot must be a no-op
  });

  after(async () => {
    await m?.db.sql.end({ timeout: 5 });
  });

  describe("screening pipeline", () => {
    let orgId: string;
    let positionId: string;
    let strongId: string;
    let weakId: string;

    it("parses a CV, lower-cases the email and files a library copy", async () => {
      orgId = (await newOrg()).id;
      positionId = (await newPosition(orgId)).id;
      strongId = await upload(orgId, positionId, strongCv("Asha Verma", "Asha.Verma@Example.com"));
      const c = await candidate(strongId);
      assert.equal(c.stage, "parsed", c.error ?? c.stageReason ?? "");
      assert.equal((await jobsFor("score_cv", "candidateId", strongId)).length, 1, "scoring queued because the spec is confirmed");
      assert.equal(c.email, "asha.verma@example.com");
      assert.ok(c.cvDocumentId, "library entry linked");
      const [doc] = await m.db.db.select().from(m.db.schema.cvDocuments).where(m.orm.eq(m.db.schema.cvDocuments.id, c.cvDocumentId!));
      assert.equal(doc.email, "asha.verma@example.com");
      assert.ok(doc.fileData && doc.fileData.length > 0, "library keeps its own file copy");
    });

    it("scores a matching CV and filters out one with none of the must-haves", async () => {
      await m.pipeline.runScoreCv({ candidateId: strongId });
      const strong = await candidate(strongId);
      assert.equal(strong.stage, "scored");
      assert.ok((strong.cvScore ?? 0) > 40, `cvScore ${strong.cvScore}`);

      weakId = await upload(orgId, positionId, cvText("Ravi Kumar", "ravi@example.com", "Retail store manager with 8 years of experience in merchandising and staff rotas."));
      await m.pipeline.runScoreCv({ candidateId: weakId });
      const weak = await candidate(weakId);
      assert.equal(weak.stage, "filtered_out");
    });

    it("selects the top candidate, designs questions, and doesn't count an invite that couldn't be sent", async () => {
      const n = await m.pipeline.selectForInterview(positionId, orgId, randomUUID());
      assert.equal(n, 1);
      await m.pipeline.runDesignQuestions({ candidateId: strongId });
      await m.pipeline.runSendInvite({ candidateId: strongId });
      const c = await candidate(strongId);
      assert.equal(c.stage, "invited");
      assert.equal(c.inviteAttempts, 0, "no email/SMS configured: nothing was sent, so nothing counts");
      assert.match(c.error ?? "", /share it manually/);
      assert.ok((await interviewOf(strongId)).questions?.length);
    });

    it("rejects an implausibly long browser transcript and accepts a real one as unverified", async () => {
      const c = await candidate(strongId);
      const { mode } = await m.pipeline.recordConsent({ token: c.inviteToken!, ip: "203.0.113.5", consentText: "I agree" });
      assert.equal(mode, "in_browser");
      // Stand in for startWebInterview (which needs OmniDimension): a session opened 5 seconds ago.
      const iv = await interviewOf(strongId);
      const setDispatched = (agoMs: number) =>
        m.db.db
          .update(m.db.schema.interviews)
          .set({ status: "dispatched", dispatchedAt: new Date(Date.now() - agoMs), attempts: 1 })
          .where(m.orm.eq(m.db.schema.interviews.id, iv.id));
      await setDispatched(5_000);
      await m.pipeline.completeWebInterview(c.inviteToken!, "Candidate: perfect answer. ".repeat(2000));
      assert.equal((await interviewOf(strongId)).status, "dispatched", "fabricated transcript must not complete the interview");

      await setDispatched(10 * 60_000);
      const transcript = [
        "Interviewer: Tell me about a recent project where you used Python.",
        "Candidate: I rebuilt our payments reconciliation service in Python and PostgreSQL, and I wrote the ingestion workers myself.",
        "Interviewer: What is your notice period?",
        "Candidate: My notice period is 30 days and I expect around 30 lakh per annum.",
      ].join("\n");
      await m.pipeline.completeWebInterview(c.inviteToken!, transcript);
      const done = await interviewOf(strongId);
      assert.equal(done.status, "completed");
      assert.equal(done.transcriptSource, "browser");
      const [job] = await jobsFor("assess_interview", "interviewId", done.id);
      // (the shared client returns timestamps as strings — see lib/jobs/queue.ts)
      assert.ok(new Date(job.run_at).getTime() > Date.now() + 60_000, "scoring waits for the provider's transcript");
    });

    it("lets the provider's webhook transcript replace the browser copy and re-score", async () => {
      const iv = await interviewOf(strongId);
      const providerTranscript = [
        "Interviewer: Tell me about a recent project where you used Python.",
        "Candidate: I rebuilt our payments reconciliation service in Python and PostgreSQL on AWS, deployed with Docker containers.",
        "Interviewer: What is your notice period?",
        "Candidate: My notice period is 30 days.",
      ].join("\n");
      await m.pipeline.enrichFromWebhook(iv.id, {
        interviewId: iv.id,
        callLogId: null,
        status: "completed",
        transcript: providerTranscript,
        recordingUrl: "https://cdn.example/rec.mp3",
        durationSec: 540,
        summary: null,
        toNumber: null,
        timeOfCall: null,
        wantsHuman: false,
      });
      const after = await interviewOf(strongId);
      assert.equal(after.transcriptSource, "provider");
      assert.equal(after.transcript, providerTranscript);
      assert.equal(after.recordingUrl, "https://cdn.example/rec.mp3");
      assert.equal((await jobsFor("assess_interview", "interviewId", iv.id)).length, 2, "re-score queued");
    });

    it("assesses the interview, writes a report and shortlists", async () => {
      const iv = await interviewOf(strongId);
      await m.pipeline.runAssessInterview({ interviewId: iv.id });
      const c = await candidate(strongId);
      assert.equal(c.stage, "shortlisted");
      assert.equal(c.finalRank, 1);
      assert.ok(c.interviewScore != null && c.finalScore != null);
      assert.ok(c.shortlistEmailSentAt, "shortlist notification marked once");
      const [report] = await m.db.db.select().from(m.db.schema.reports).where(m.orm.eq(m.db.schema.reports.candidateId, strongId));
      assert.ok(report.content.summary);
    });

    it("re-screens library CVs for a new role exactly once", async () => {
      const second = await newPosition(orgId);
      const added = await m.pipeline.matchPoolToPosition(second.id, orgId);
      assert.equal(added, 2);
      assert.equal(await m.pipeline.matchPoolToPosition(second.id, orgId), 0);
    });

    it("erases a person everywhere: this application, other roles and the library", async () => {
      const email = "asha.verma@example.com";
      const positions = await m.pipeline.eraseCandidateData(orgId, strongId);
      assert.equal(positions.length, 2);
      const left = await m.db.sql`select id from candidates where org_id = ${orgId} and lower(email) = ${email}`;
      const docs = await m.db.sql`select id from cv_documents where org_id = ${orgId} and email = ${email}`;
      assert.equal(left.length + docs.length, 0);
    });

    it("purges records idle past the retention window, including the library", async () => {
      await m.db.sql`update candidates set updated_at = now() - interval '400 days' where org_id = ${orgId}`;
      await m.db.sql`update cv_documents set updated_at = now() - interval '400 days' where org_id = ${orgId}`;
      await m.pipeline.applyRetention();
      const [{ n }] = await m.db.sql<{ n: number }[]>`
        select (select count(*) from candidates where org_id = ${orgId}) + (select count(*) from cv_documents where org_id = ${orgId}) as n`;
      assert.equal(Number(n), 0);
    });
  });

  describe("rate limiting", () => {
    it("blocks after the limit and keeps keys independent", async () => {
      const key = `test:${randomUUID()}`;
      const limit = { max: 2, windowSec: 60 };
      assert.equal((await m.rate.hit(key, limit)).ok, true);
      assert.equal((await m.rate.hit(key, limit)).ok, true);
      const third = await m.rate.hit(key, limit);
      assert.equal(third.ok, false);
      assert.ok(third.retryAfterSec > 0 && third.retryAfterSec <= 60);
      assert.equal((await m.rate.hit(`${key}:other`, limit)).ok, true);
      await assert.rejects(m.rate.enforce([key, limit]), m.rate.RateLimitError);
    });
  });

  describe("job queue", () => {
    it("recovers a job from a dead worker, and fails one that has used all its attempts", async () => {
      const { sql } = m.db;
      const [retry] = await sql<{ id: number }[]>`
        insert into jobs (type, payload, status, attempts, max_attempts, locked_at) values ('parse_cv', '{}', 'running', 1, 3, now() - interval '30 minutes') returning id`;
      const [dead] = await sql<{ id: number }[]>`
        insert into jobs (type, payload, status, attempts, max_attempts, locked_at) values ('parse_cv', '{}', 'running', 3, 3, now() - interval '30 minutes') returning id`;
      const [fresh] = await sql<{ id: number }[]>`
        insert into jobs (type, payload, status, attempts, max_attempts, locked_at) values ('parse_cv', '{}', 'running', 1, 3, now()) returning id`;
      await m.queue.requeueStale();
      const status = async (id: number) => (await sql<{ status: string }[]>`select status from jobs where id = ${id}`)[0].status;
      assert.equal(await status(retry.id), "pending");
      assert.equal(await status(dead.id), "failed");
      assert.equal(await status(fresh.id), "running", "a job that's still being worked on is left alone");
      await sql`delete from jobs where id in (${retry.id}, ${dead.id}, ${fresh.id})`;
    });
  });
}
