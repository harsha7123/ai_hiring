import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { AuthError, requireAction } from "@/lib/auth/guard";
import { ACCEPTED_MIME } from "@/lib/extract";

export async function GET(_: Request, { params }: RouteContext<"/api/candidates/[id]/cv">) {
  let ctx;
  try {
    ctx = await requireAction("viewer");
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [c] = await db
    .select({ fileName: schema.candidates.fileName, fileMime: schema.candidates.fileMime, fileData: schema.candidates.fileData })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, id), eq(schema.candidates.orgId, ctx.org.id)));
  if (!c?.fileData) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id, action: "candidate.cv_downloaded", target: id });
  const ext = ACCEPTED_MIME[c.fileMime] ?? "bin";
  const name = c.fileName.toLowerCase().endsWith(`.${ext}`) ? c.fileName : `${c.fileName}.${ext}`;
  return new NextResponse(new Uint8Array(c.fileData), {
    headers: {
      "Content-Type": c.fileMime,
      // Always download: never render untrusted uploads inline on our origin.
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
