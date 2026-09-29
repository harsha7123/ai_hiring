import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { AuthError, requireAction } from "@/lib/auth/guard";
import { MAX_CV_BYTES, sniffMime } from "@/lib/extract";
import { enqueue } from "@/lib/jobs/queue";

const MAX_CVS_PER_ROLE = Number(process.env.MAX_CVS_PER_ROLE ?? 5000);

/** Same-origin check for cookie-authenticated POSTs (defence in depth over SameSite=Lax). */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
}

export async function POST(req: Request, { params }: RouteContext<"/api/positions/[id]/upload">) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  let ctx;
  try {
    ctx = await requireAction("recruiter");
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const { id } = await params;
  const [position] = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .where(and(eq(schema.positions.id, id), eq(schema.positions.orgId, ctx.org.id)));
  if (!position) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.candidates)
    .where(eq(schema.candidates.positionId, id));
  if (n >= MAX_CVS_PER_ROLE) return NextResponse.json({ error: `Limit of ${MAX_CVS_PER_ROLE} CVs per role reached` }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_CV_BYTES) return NextResponse.json({ error: "File is larger than 10 MB" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "cv";
  const mime = sniffMime(buf, fileName);
  if (!mime) return NextResponse.json({ error: "Unsupported file type (use PDF, DOCX, TXT or an image)" }, { status: 400 });

  const [c] = await db
    .insert(schema.candidates)
    .values({ orgId: ctx.org.id, positionId: id, fileName, fileMime: mime, fileData: buf })
    .returning({ id: schema.candidates.id });
  await enqueue("parse_cv", { candidateId: c.id }, { orgId: ctx.org.id });
  return NextResponse.json({ id: c.id });
}
