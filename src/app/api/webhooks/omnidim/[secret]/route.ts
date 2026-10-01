import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { parseCallResult } from "@/lib/omnidim";
import { enrichFromWebhook } from "@/lib/pipeline";

/**
 * OmniDimension post-call webhook. The per-organisation secret in the URL authenticates
 * the sender and selects the tenant. This is a best-effort enrichment (recording link,
 * sentiment) — the interview itself is already completed and scored from the transcript
 * the candidate's own browser session captured, so a missed or delayed webhook never
 * blocks anything.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/webhooks/omnidim/[secret]">) {
  const { secret } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return NextResponse.json({ ok: false }, { status: 404 });
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.webhookSecret, secret));
  if (!org || !safeEqual(org.webhookSecret, secret)) return NextResponse.json({ ok: false }, { status: 404 });

  const raw = await req.text();
  if (raw.length > 2_000_000) return NextResponse.json({ ok: false }, { status: 413 });
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
  await enrichFromWebhook(iv.id, result);
  return NextResponse.json({ ok: true, matched: true });
}
