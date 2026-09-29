import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { parseCallResult, phoneKey } from "@/lib/omnidim";
import { applyCallResult } from "@/lib/pipeline";

/**
 * OmniDimension post-call webhook. The per-organisation secret in the URL authenticates
 * the sender and selects the tenant; interview lookups are always scoped to that tenant.
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

  let interviewId: string | null = null;
  if (result.interviewId && /^[0-9a-f-]{36}$/i.test(result.interviewId)) {
    const [iv] = await db
      .select({ id: schema.interviews.id })
      .from(schema.interviews)
      .where(and(eq(schema.interviews.id, result.interviewId), eq(schema.interviews.orgId, org.id)));
    interviewId = iv?.id ?? null;
  }
  if (!interviewId && result.toNumber) {
    // Fallback: latest in-flight call to this number within the tenant.
    const inflight = await db
      .select({ id: schema.interviews.id, phone: schema.candidates.phone })
      .from(schema.interviews)
      .innerJoin(schema.candidates, eq(schema.candidates.id, schema.interviews.candidateId))
      .where(and(eq(schema.interviews.orgId, org.id), eq(schema.interviews.status, "dispatched")))
      .orderBy(desc(schema.interviews.dispatchedAt));
    interviewId = inflight.find((r) => phoneKey(r.phone) === phoneKey(result.toNumber))?.id ?? null;
  }
  if (!interviewId) {
    console.warn(`[webhook] org ${org.id}: no matching interview for call ${result.callLogId ?? "?"}`);
    return NextResponse.json({ ok: true, matched: false });
  }
  await applyCallResult(interviewId, result);
  return NextResponse.json({ ok: true, matched: true });
}
