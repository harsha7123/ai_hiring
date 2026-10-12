import { hostname } from "node:os";
import { sql } from "@/db";
import * as pipeline from "@/lib/pipeline";
import { ensureVoiceAgentsProvisioned } from "@/lib/omnidim";
import { log, reportError } from "@/lib/log";
import { pruneRateLimits } from "@/lib/rate-limit";
import { claim, complete, fail, pruneDone, requeueStale, type Job, type JobType } from "./queue";

const HANDLERS: Record<JobType, (payload: never) => Promise<void>> = {
  extract_spec: pipeline.runExtractSpec,
  parse_cv: pipeline.runParseCv,
  score_cv: pipeline.runScoreCv,
  design_questions: pipeline.runDesignQuestions,
  send_invite: pipeline.runSendInvite,
  assess_interview: pipeline.runAssessInterview,
};

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 6);
const TICK_MS = 45_000;
/** How long the poll loop sleeps between claims when there's no work. On a
 * shared/free-tier CPU this loop runs in the same process as web requests, so
 * polling too tightly steals cycles from actual page loads for no benefit —
 * there's nothing time-critical about noticing a new job a few seconds later. */
const IDLE_SLEEP_MS = 4_000;
/** On shutdown, how long to let running jobs finish before exiting (platforms usually allow ~30 s after SIGTERM). */
const DRAIN_MS = 25_000;
const WORKER_ID = `${hostname()}:${process.pid}`;

let running = 0;
let started = false;
let stopping = false;
let lastRetention = 0;

async function runJob(job: Job) {
  running++;
  const startedAt = Date.now();
  try {
    await HANDLERS[job.type](job.payload as never);
    await complete(job.id);
    log.info("job done", { jobId: job.id, type: job.type, ms: Date.now() - startedAt });
  } catch (err) {
    const final = await fail(job, err).catch(() => true);
    if (final) reportError(`job ${job.type} failed permanently`, err, { jobId: job.id, attempts: job.attempts });
    else log.warn("job failed, will retry", { jobId: job.id, type: job.type, attempt: job.attempts, err });
  } finally {
    running--;
  }
}

async function pollLoop() {
  while (!stopping) {
    try {
      const jobs = await claim(CONCURRENCY - running);
      for (const job of jobs) void runJob(job);
      await sleep(jobs.length ? 500 : IDLE_SLEEP_MS);
    } catch (err) {
      reportError("worker poll failed", err);
      await sleep(5000);
    }
  }
}

async function heartbeat() {
  await sql`
    insert into worker_heartbeats (id, last_seen) values (${WORKER_ID}, now())
    on conflict (id) do update set last_seen = now()`;
}

/**
 * Scheduler: expires abandoned interview sessions, dials due phone interviews,
 * retries invitations, provisions voice agents, moves CV files to storage,
 * applies retention. A transaction-scoped advisory lock keeps the shared part
 * to one instance at a time; every worker still records its own heartbeat.
 */
async function tick() {
  if (stopping) return;
  try {
    await heartbeat();
    await sql.begin(async (tx) => {
      const [{ locked }] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(727201) as locked`;
      if (!locked) return;
      await requeueStale();
      await pipeline.expireStaleWebSessions();
      await pipeline.dispatchDueInterviews();
      await pipeline.syncDispatchedCalls();
      await pipeline.retryInvites();
      await ensureVoiceAgentsProvisioned();
      await pipeline.migrateCvFilesToStorage();
      if (Date.now() - lastRetention > 6 * 3600_000) {
        lastRetention = Date.now();
        await pipeline.applyRetention();
        await pruneDone();
        await pruneRateLimits();
        await sql`delete from worker_heartbeats where last_seen < now() - interval '1 day'`;
      }
    });
  } catch (err) {
    reportError("scheduler tick failed", err);
  }
}

/** Stops claiming new jobs and gives running ones time to finish, so a deploy doesn't cut a scoring call in half. */
async function drain(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("worker draining", { signal, running });
  const deadline = Date.now() + DRAIN_MS;
  while (running > 0 && Date.now() < deadline) await sleep(250);
  if (running > 0) log.warn("worker exiting with jobs still running; they will be retried", { running });
  process.exit(0);
}

/**
 * `standalone` is the dedicated worker process (`npm run worker`), which owns
 * its shutdown and drains running jobs. Inside the web server, Next.js handles
 * SIGTERM itself; jobs cut off by a restart there are picked up again by
 * requeueStale.
 */
export function startWorker({ standalone = false }: { standalone?: boolean } = {}) {
  if (started) return;
  started = true;
  log.info("worker started", { id: WORKER_ID, concurrency: CONCURRENCY, standalone });
  void pollLoop();
  void tick();
  setInterval(tick, TICK_MS);
  if (standalone) {
    process.once("SIGTERM", () => void drain("SIGTERM"));
    process.once("SIGINT", () => void drain("SIGINT"));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
