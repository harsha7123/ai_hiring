import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { readBodyCapped } from "@/lib/http";
import { reportError } from "@/lib/log";
import { parseCallResult } from "@/lib/omnidim";
import { enrichFromWebhook } from "@/lib/pipeline";
import { hit, LIMITS } from "@/lib/rate-limit";

/**
 * OmniDimension post-call webhook. The per-organisation secret in the URL
 * authenticates the sender and selects the tenant. For phone-call interviews it
 * is the completion signal; for in-browser ones it delivers the authoritative
 * transcript and the recording link (see enrichFromWebhook).
 */
export async function POST(req: Request, { params }: RouteContext<"/api/webhooks/omnidim/[secret]">) {
  const { secret } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return NextResponse.json({ ok: false }, { status: 404 });
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.webhookSecret, secret));
  if (!org || !safeEqual(org.webhookSecret, secret)) return NextResponse.json({ ok: false }, { status: 404 });

  const r = await hit(`webhook:${org.id}`, LIMITS.webhookPerOrg);
  if (!r.ok) return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });

  const raw = await readBodyCapped(req, 2_000_000);
  if (raw === null) return NextResponse.json({ ok: false }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const result = parseCallResult(payload);
  if (!result.interviewId || !/^[0-9a-f-]{36}$/i.test(result.interviewId)) {
    return NextResponse.json({ ok: true, matched: false });
  }
  const [iv] = await db
    .select({ id: schema.interviews.id })
    .from(schema.interviews)
    .where(and(eq(schema.interviews.id, result.interviewId), eq(schema.interviews.orgId, org.id)));
  if (!iv) return NextResponse.json({ ok: true, matched: false });
  try {
    await enrichFromWebhook(iv.id, result);
  } catch (err) {
    // 500 so OmniDimension retries delivery, if it does; the call-log poller is the fallback either way.
    reportError("webhook processing failed", err, { orgId: org.id, interviewId: iv.id });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, matched: true });
}
