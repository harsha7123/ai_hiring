import { NextResponse } from "next/server";
import { completeWebInterview } from "@/lib/pipeline";

/**
 * The candidate's browser posts here the moment its OmniDimension session ends,
 * with the transcript it captured live from the SDK's own transcript events.
 * This marks the interview finished even if the webhook never arrives, but the
 * transcript itself is untrusted (the candidate controls this request): see
 * completeWebInterview for how it's checked and superseded.
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
  // Duration is measured on the server from when the session was created; a
  // client-supplied one is ignored.
  const { transcript } = (body ?? {}) as { transcript?: unknown };
  if (typeof transcript !== "string" || transcript.length > 200_000) {
    return NextResponse.json({ error: "Invalid transcript" }, { status: 400 });
  }

  try {
    await completeWebInterview(token, transcript);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save the interview" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
