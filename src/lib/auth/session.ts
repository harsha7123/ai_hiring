import "server-only";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken, sha256 } from "@/lib/crypto";

export const SESSION_COOKIE = "sl_session";
const SESSION_DAYS = 7;

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string, orgId: string) {
  const token = randomToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    orgId,
    expiresAt,
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function readSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      user: { id: schema.users.id, email: schema.users.email, name: schema.users.name },
      org: { id: schema.organizations.id, name: schema.organizations.name },
      role: schema.memberships.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.sessions.orgId))
    // Membership must still exist: removing a member revokes access immediately.
    .innerJoin(
      schema.memberships,
      and(eq(schema.memberships.userId, schema.sessions.userId), eq(schema.memberships.orgId, schema.sessions.orgId)),
    )
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const s = rows[0];
  if (!s) return null;
  // Sliding expiry: extend in the DB when less than half the lifetime remains.
  if (s.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 864e5) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) })
      .where(eq(schema.sessions.id, s.sessionId));
  }
  return s;
}

export async function switchSessionOrg(orgId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db.update(schema.sessions).set({ orgId }).where(eq(schema.sessions.id, sha256(token)));
}
