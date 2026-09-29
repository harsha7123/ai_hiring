"use server";

import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { tooManyFailures } from "@/lib/auth/rate-limit";
import { clientIp, createSession, destroySession, readSession, switchSessionOrg } from "@/lib/auth/session";
import type { FormState } from "@/components/client";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);

export const signupAllowed = async () => process.env.ALLOW_SIGNUP !== "false";

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await signupAllowed())) return { error: "Self-service sign-up is disabled. Ask your administrator for an invite." };
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Enter your name").max(100),
      orgName: z.string().trim().min(2, "Enter your organisation name").max(100),
      email,
      password: z.string(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, orgName, password } = parsed.data;
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, parsed.data.email));
  if (existing) return { error: "An account with this email already exists. Sign in instead." };

  const passwordHash = await hashPassword(password);
  const { userId, orgId } = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(schema.organizations)
      .values({ name: orgName, webhookSecret: randomToken(24), settings: { retentionRecordingDays: 90, retentionRecordDays: 180 } })
      .returning({ id: schema.organizations.id });
    const [user] = await tx.insert(schema.users).values({ email: parsed.data.email, name, passwordHash }).returning({ id: schema.users.id });
    await tx.insert(schema.memberships).values({ userId: user.id, orgId: org.id, role: "owner" });
    return { userId: user.id, orgId: org.id };
  });
  await createSession(userId, orgId);
  await audit({ orgId, userId, action: "auth.signup", ip: await clientIp() });
  redirect("/app");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Enter your email and password." };
  const ip = await clientIp();
  if (await tooManyFailures({ email: parsed.data.email, ip })) {
    return { error: "Too many failed attempts. Wait 15 minutes and try again." };
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email));
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await audit({ action: "auth.login_failed", ip, meta: { email: parsed.data.email } });
    return { error: "Incorrect email or password." };
  }
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(desc(schema.memberships.createdAt))
    .limit(1);
  if (!m) return { error: "Your account is not a member of any organisation." };
  await createSession(user.id, m.orgId);
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  await audit({ orgId: m.orgId, userId: user.id, action: "auth.login", ip });
  redirect("/app");
}

export async function logout() {
  const s = await readSession();
  await destroySession();
  if (s) await audit({ orgId: s.org.id, userId: s.user.id, action: "auth.logout" });
  redirect("/login");
}

export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  if (!invite) return { error: "This invitation is invalid or has expired." };

  const password = String(fd.get("password") ?? "");
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
  let userId: string;
  if (existing) {
    if (!(await verifyPassword(password, existing.passwordHash))) return { error: "Enter the password for your existing account." };
    userId = existing.id;
  } else {
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return { error: "Enter your name." };
    const problem = passwordProblem(password);
    if (problem) return { error: problem };
    const [u] = await db
      .insert(schema.users)
      .values({ email: invite.email, name: name.slice(0, 100), passwordHash: await hashPassword(password) })
      .returning({ id: schema.users.id });
    userId = u.id;
  }
  await db.insert(schema.memberships).values({ userId, orgId: invite.orgId, role: invite.role }).onConflictDoNothing();
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  await createSession(userId, invite.orgId);
  await audit({ orgId: invite.orgId, userId, action: "member.joined", meta: { role: invite.role } });
  redirect("/app");
}

export async function switchOrg(fd: FormData) {
  const s = await readSession();
  if (!s) redirect("/login");
  const orgId = String(fd.get("orgId") ?? "");
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, s.user.id), eq(schema.memberships.orgId, orgId)));
  if (m) await switchSessionOrg(orgId);
  redirect("/app");
}
