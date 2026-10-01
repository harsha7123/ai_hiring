import { NextResponse } from "next/server";
import { completeWebInterview } from "@/lib/pipeline";

/**
 * The candidate's browser posts here the moment its OmniDimension session ends,
 * with the transcript it captured live from the SDK's own transcript events.
 * This is the guaranteed completion path — scoring never depends on a webhook.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/i/[token]/complete">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { transcript, durationSec } = (body ?? {}) as { transcript?: unknown; durationSec?: unknown };
  if (typeof transcript !== "string" || transcript.length > 200_000) {
    return NextResponse.json({ error: "Invalid transcript" }, { status: 400 });
  }
  const duration = typeof durationSec === "number" && Number.isFinite(durationSec) ? Math.round(durationSec) : null;

  try {
    await completeWebInterview(token, transcript, duration);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save the interview" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
