/**
 * Fixed-window rate limiting, stored in Postgres so every web instance shares
 * the same counters. One atomic upsert per check: no read-modify-write race.
 */
import { sql } from "@/db";
import { log } from "./log";

export type Limit = { max: number; windowSec: number };

/** The limits used across the app, in one place so they're easy to tune. */
export const LIMITS = {
  loginPerIp: { max: 20, windowSec: 15 * 60 },
  loginPerEmail: { max: 8, windowSec: 15 * 60 },
  signupPerIp: { max: 5, windowSec: 60 * 60 },
  passwordResetPerIp: { max: 5, windowSec: 60 * 60 },
  passwordResetPerEmail: { max: 3, windowSec: 60 * 60 },
  invitePagePerIp: { max: 30, windowSec: 10 * 60 },
  candidateActionPerToken: { max: 15, windowSec: 10 * 60 },
  candidateActionPerIp: { max: 40, windowSec: 10 * 60 },
  uploadPerUser: { max: 1500, windowSec: 60 * 60 },
  webhookPerOrg: { max: 600, windowSec: 60 },
} satisfies Record<string, Limit>;

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Too many attempts. Please wait ${retryAfterSec >= 120 ? `${Math.ceil(retryAfterSec / 60)} minutes` : `${retryAfterSec} seconds`} and try again.`);
  }
}

/**
 * Counts one hit against `key` and reports whether it's within `limit`.
 * Fails open (allows the request) if the database is unreachable — a limiter
 * outage must not lock everyone out of sign-in — and logs it.
 */
export async function hit(key: string, limit: Limit): Promise<{ ok: boolean; retryAfterSec: number }> {
  try {
    // Seconds until the window resets are computed in SQL: the shared client
    // returns timestamps as strings, which JavaScript's Date can't parse reliably.
    const [row] = await sql<{ count: number; retry: number }[]>`
      insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start < now() - make_interval(secs => ${limit.windowSec}) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${limit.windowSec}) then now() else rate_limits.window_start end
      returning count, ceil(extract(epoch from (window_start + make_interval(secs => ${limit.windowSec}) - now())))::int as retry`;
    return { ok: Number(row.count) <= limit.max, retryAfterSec: Math.max(1, Number(row.retry) || 1) };
  } catch (err) {
    log.warn("rate limiter unavailable, allowing request", { key: key.split(":")[0], err });
    return { ok: true, retryAfterSec: 0 };
  }
}

/** Throws RateLimitError when any of the given keys is over its limit. All keys are counted. */
export async function enforce(...checks: [key: string, limit: Limit][]) {
  const results = await Promise.all(checks.map(([k, l]) => hit(k, l)));
  const blocked = results.filter((r) => !r.ok);
  if (blocked.length) throw new RateLimitError(Math.max(...blocked.map((r) => r.retryAfterSec)));
}

/** Drops counters whose window ended long ago. Run from the scheduler. */
export async function pruneRateLimits() {
  await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
}

/**
 * The client's IP address as seen by the platform's reverse proxy.
 *
 * X-Forwarded-For is a comma list that anyone can pre-fill; only the entries
 * appended by proxies you control are trustworthy. By default this takes the
 * last entry (added by the hosting platform's own proxy — right for Railway,
 * Render, Fly and a single Caddy/Nginx). Behind two proxies (e.g. Cloudflare
 * in front of the platform) set TRUSTED_PROXY_HOPS=2.
 */
export function ipFromHeaders(get: (name: string) => string | null, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string | null {
  const xff = get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const pick = parts[Math.max(0, parts.length - Math.max(1, hops))];
    if (pick) return pick;
  }
  return get("x-real-ip")?.trim() || null;
}
