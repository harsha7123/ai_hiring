import { NextResponse } from "next/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

/** A worker that hasn't checked in for this long has stopped (the scheduler ticks every 45 s). */
const WORKER_STALE_SEC = 300;
/** Pending jobs older than this mean work is piling up faster than it's processed. */
const BACKLOG_AGE_SEC = 900;

/**
 * GET /api/health          liveness: the process is up and can reach the database.
 *                          Used by the container HEALTHCHECK and the platform's health check.
 * GET /api/health?deep=1   for an uptime monitor: also fails when no worker has checked in
 *                          recently or jobs are stuck, which a plain liveness check can't see.
 *
 * Only counts and booleans are returned — nothing about tenants or data.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  try {
    await sql`select 1`;
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
  if (!deep) return NextResponse.json({ ok: true });

  try {
    const [w] = await sql<{ age: number | null }[]>`select extract(epoch from now() - max(last_seen))::int as age from worker_heartbeats`;
    const [j] = await sql<{ backlog: number; failed: number }[]>`
      select
        count(*) filter (where status = 'pending' and run_at < now() - make_interval(secs => ${BACKLOG_AGE_SEC}))::int as backlog,
        count(*) filter (where status = 'failed' and created_at > now() - interval '1 hour')::int as failed
      from jobs`;
    const workerOk = w.age != null && w.age < WORKER_STALE_SEC;
    const queueOk = j.backlog === 0;
    const ok = workerOk && queueOk;
    return NextResponse.json(
      { ok, db: true, worker: { ok: workerOk, lastSeenSecAgo: w.age }, queue: { ok: queueOk, stuckJobs: j.backlog, failedLastHour: j.failed } },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ ok: false, db: true, error: "health query failed" }, { status: 503 });
  }
}
