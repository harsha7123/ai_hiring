import { sql } from "@/db";

export type JobType = "extract_spec" | "parse_cv" | "score_cv" | "design_questions" | "send_invite" | "assess_interview";

export type Job = { id: number; type: JobType; payload: Record<string, unknown>; attempts: number; max_attempts: number };

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { orgId?: string; runAt?: Date; maxAttempts?: number } = {}) {
  await sql`
    insert into jobs (type, payload, org_id, run_at, max_attempts)
    values (${type}, ${JSON.stringify(payload)}::jsonb, ${opts.orgId ?? null}, ${(opts.runAt ?? new Date()).toISOString()}::timestamptz, ${opts.maxAttempts ?? 3})`;
}

export async function enqueueMany(type: JobType, payloads: Record<string, unknown>[], orgId: string) {
  for (const p of payloads) await enqueue(type, p, { orgId });
}

/** Claim up to n due jobs. SKIP LOCKED makes this safe with several workers. */
export async function claim(n: number): Promise<Job[]> {
  if (n <= 0) return [];
  // Drizzle registers pass-through JSON parsers on this client, so payload may arrive as text.
  const rows = await sql<Job[]>`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from jobs where status = 'pending' and run_at <= now()
      order by run_at limit ${n} for update skip locked)
    returning id, type, payload, attempts, max_attempts`;
  return rows.map((r) => ({ ...r, payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload }));
}

export async function complete(id: number) {
  await sql`update jobs set status = 'done', locked_at = null, last_error = null where id = ${id}`;
}

export async function fail(job: Job, err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  const final = job.attempts >= job.max_attempts;
  // Exponential backoff: 30s, 2m, 8m ...
  const delaySec = 30 * 4 ** (job.attempts - 1);
  await sql`
    update jobs set status = ${final ? "failed" : "pending"}, locked_at = null, last_error = ${message},
      run_at = now() + make_interval(secs => ${delaySec}::int)
    where id = ${job.id}`;
  return final;
}

/** Recover jobs whose worker died mid-run. */
export async function requeueStale() {
  await sql`update jobs set status = 'pending', locked_at = null where status = 'running' and locked_at < now() - interval '15 minutes'`;
}

export async function pruneDone() {
  await sql`delete from jobs where status = 'done' and created_at < now() - interval '3 days'`;
}
