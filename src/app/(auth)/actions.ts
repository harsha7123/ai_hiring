"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_ORG_SETTINGS } from "@/db/schema";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { passwordProblem } from "@/lib/auth/password-policy";
import { clientIp, destroySession, readSession, switchSessionOrg } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";
import { friendlyAuthError } from "@/lib/supabase/errors";
import { autoProvisionVoiceAgent } from "@/lib/omnidim";
import type { FormState } from "@/components/client";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);

export const signupAllowed = async () => process.env.ALLOW_SIGNUP !== "false";

/** True once Supabase Auth returns a session immediately (email confirmation is off in the project). */
const CONFIRM_MSG = "Check your email for a confirmation link, then sign in.";

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
  const { name, orgName, email: emailAddr, password } = parsed.data;
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email: emailAddr, password, options: { data: { name } } });
  if (error) return { error: friendlyAuthError(error) };
  if (!data.user) return { error: "Could not create the account. Try again." };

  // Supabase can return an existing (unconfirmed) user without an error, to avoid
  // leaking which emails are registered. Detect that by checking for an existing
  // membership rather than trusting the absence of an `error`.
  const [already] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.userId, data.user.id)).limit(1);
  if (already) return { error: "An account with this email already exists. Sign in instead." };

  try {
    await db
      .insert(schema.users)
      .values({ id: data.user.id, email: emailAddr, name })
      .onConflictDoUpdate({ target: schema.users.id, set: { email: emailAddr, name } });
  } catch {
    // A local profile row for this email already exists under a different id —
    // can only happen if a Supabase account was deleted and recreated with the
    // same address. Too rare to auto-merge safely; ask for a different path.
    return { error: "Could not create the account for this email. If you previously had an account, contact your administrator." };
  }
  const webhookSecret = randomToken(24);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: orgName, webhookSecret, settings: DEFAULT_ORG_SETTINGS })
    .returning({ id: schema.organizations.id });
  await db.insert(schema.memberships).values({ userId: data.user.id, orgId: org.id, role: "owner" });
  await audit({ orgId: org.id, userId: data.user.id, action: "auth.signup", ip: await clientIp() });
  await autoProvisionVoiceAgent({ id: org.id, name: orgName, webhookSecret });

  if (!data.session) return { ok: CONFIRM_MSG };
  redirect("/app");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Enter your email and password." };
  const ip = await clientIp();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    await audit({ action: "auth.login_failed", ip, meta: { email: parsed.data.email, code: error.code ?? null } });
    return { error: friendlyAuthError(error) };
  }
  await audit({ userId: data.user.id, action: "auth.login", ip });
  redirect("/app");
}

export async function logout() {
  const s = await readSession();
  await destroySession();
  if (s) await audit({ orgId: s.org.id, userId: s.user.id, action: "auth.logout" });
  redirect("/login");
}

/**
 * Invited users don't set a membership directly here — they just get a Supabase
 * account for the exact invited email. The membership is attached automatically
 * the next time they load a page (see consumePendingInvites in lib/auth/session.ts),
 * which also covers someone who already has an account and simply signs in.
 */
export async function joinInvite(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  if (!invite) return { error: "This invitation is invalid, already used, or has expired." };

  const name = String(fd.get("name") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!name) return { error: "Enter your name." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const supabase = await supabaseServer();
  // Always the invite's own email — never a client-supplied one — so the new
  // account can only ever join the workspace it was actually invited to.
  const { data, error } = await supabase.auth.signUp({ email: invite.email, password, options: { data: { name } } });
  if (error) return { error: friendlyAuthError(error) };
  if (!data.session) return { ok: CONFIRM_MSG };
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
  if (m) await switchSessionOrg(s.user.id, orgId);
  redirect("/app");
}

/** For a signed-in Supabase user with no workspace yet (see /no-workspace). */
export async function createWorkspace(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const orgName = String(fd.get("orgName") ?? "").trim();
  if (orgName.length < 2) return { error: "Enter an organisation name." };

  const webhookSecret = randomToken(24);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: orgName, webhookSecret, settings: DEFAULT_ORG_SETTINGS })
    .returning({ id: schema.organizations.id });
  await db.insert(schema.memberships).values({ userId: user.id, orgId: org.id, role: "owner" }).onConflictDoNothing();
  await audit({ orgId: org.id, userId: user.id, action: "auth.signup", ip: await clientIp() });
  await autoProvisionVoiceAgent({ id: org.id, name: orgName, webhookSecret });
  redirect("/app");
}
