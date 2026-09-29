import { sql } from "@/db";
import * as pipeline from "@/lib/pipeline";
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
const TICK_MS = 20_000;
let running = 0;
let started = false;
let lastRetention = 0;

async function runJob(job: Job) {
  running++;
  try {
    await HANDLERS[job.type](job.payload as never);
    await complete(job.id);
  } catch (err) {
    const final = await fail(job, err);
    console.error(`[worker] job ${job.id} ${job.type} failed${final ? " permanently" : ""}:`, err instanceof Error ? err.message : err);
  } finally {
    running--;
  }
}

async function pollLoop() {
  for (;;) {
    try {
      const jobs = await claim(CONCURRENCY - running);
      for (const job of jobs) void runJob(job);
      await sleep(jobs.length ? 200 : 1000);
    } catch (err) {
      console.error("[worker] poll error", err);
      await sleep(5000);
    }
  }
}

/**
 * Scheduler: dials due interviews, reconciles call results, retries invitations.
 * A transaction-scoped advisory lock keeps it to one instance at a time.
 */
async function tick() {
  try {
    await sql.begin(async (tx) => {
      const [{ locked }] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(727201) as locked`;
      if (!locked) return;
      await requeueStale();
      await pipeline.dispatchDueInterviews();
      await pipeline.syncDispatchedCalls();
      await pipeline.retryInvites();
      if (Date.now() - lastRetention > 6 * 3600_000) {
        lastRetention = Date.now();
        await pipeline.applyRetention();
        await pruneDone();
      }
    });
  } catch (err) {
    console.error("[worker] tick error", err);
  }
}

export function startWorker() {
  if (started) return;
  started = true;
  console.log(`[worker] started (concurrency ${CONCURRENCY})`);
  void pollLoop();
  void tick();
  setInterval(tick, TICK_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
