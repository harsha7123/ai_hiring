"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_ORG_SETTINGS } from "@/db/schema";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { passwordProblem } from "@/lib/auth/password-policy";
import { acceptInviteForUser, clientIp, destroySession, readSession, switchSessionOrg, verifiedUser } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";
import { friendlyAuthError } from "@/lib/supabase/errors";
import { autoProvisionVoiceAgent } from "@/lib/omnidim";
import { enforce, LIMITS, RateLimitError } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/auth/redirects";
import type { FormState } from "@/components/client";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
/** Where Supabase's confirmation / recovery emails send people back to (see app/auth/callback). */
const callbackUrl = (next: string) => `${appUrl()}/auth/callback?next=${encodeURIComponent(next)}`;

export const signupAllowed = async () => process.env.ALLOW_SIGNUP !== "false";

const CONFIRM_MSG = "Check your email for a confirmation link. It signs you in and takes you to your workspace.";

/** Turns a rate-limit rejection into a form error; anything else propagates. */
async function limited(fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message };
    throw err;
  }
}

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  return limited(async () => {
    if (!(await signupAllowed())) return { error: "Self-service sign-up is disabled. Ask your administrator for an invite." };
    const ip = await clientIp();
    await enforce([`signup:ip:${ip}`, LIMITS.signupPerIp]);
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
    const { data, error } = await supabase.auth.signUp({ email: emailAddr, password, options: { data: { name }, emailRedirectTo: callbackUrl("/app") } });
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
    await audit({ orgId: org.id, userId: data.user.id, action: "auth.signup", ip });
    await autoProvisionVoiceAgent({ id: org.id, name: orgName, webhookSecret });

    if (!data.session) return { ok: CONFIRM_MSG };
    redirect("/app");
  });
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  return limited(async () => {
    const parsed = z.object({ email, password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { error: "Enter your email and password." };
    const ip = await clientIp();
    // Per IP stops one source spraying many accounts; per email stops a
    // distributed guess against one account. Supabase adds its own limits too.
    await enforce([`login:ip:${ip}`, LIMITS.loginPerIp], [`login:email:${parsed.data.email}`, LIMITS.loginPerEmail]);
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    if (error) {
      await audit({ action: "auth.login_failed", ip, meta: { email: parsed.data.email, code: error.code ?? null } });
      return { error: friendlyAuthError(error) };
    }
    await audit({ userId: data.user.id, action: "auth.login", ip });
    redirect(safeNextPath(fd.get("next")));
  });
}

export async function logout() {
  const s = await readSession();
  await destroySession();
  if (s) await audit({ orgId: s.org.id, userId: s.user.id, action: "auth.logout" });
  redirect("/login");
}

/**
 * Sends a password-reset email. Always answers the same way whether or not the
 * address has an account, so this form can't be used to discover who's registered.
 */
export async function requestPasswordReset(_: FormState, fd: FormData): Promise<FormState> {
  return limited(async () => {
    const parsed = email.safeParse(fd.get("email"));
    if (!parsed.success) return { error: "Enter a valid email address." };
    const ip = await clientIp();
    await enforce([`reset:ip:${ip}`, LIMITS.passwordResetPerIp], [`reset:email:${parsed.data}`, LIMITS.passwordResetPerEmail]);
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: callbackUrl("/reset-password") });
    await audit({ action: "auth.password_reset_requested", ip, meta: { email: parsed.data, code: error?.code ?? null } });
    return { ok: "If an account exists for that email, a reset link is on its way. It expires in an hour." };
  });
}

/** Sets a new password for the user signed in by the reset link. */
export async function updatePassword(_: FormState, fd: FormData): Promise<FormState> {
  const user = await verifiedUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: friendlyAuthError(error) };
  await audit({ userId: user.id, action: "auth.password_changed", ip: await clientIp() });
  redirect("/app");
}

/**
 * Creates a Supabase account for the exact invited email and, when Supabase
 * signs them straight in, accepts the invite right away (the token in the form
 * is the proof they were sent it). With email confirmation on, the
 * confirmation link brings them back to this invite page, signed in, to accept.
 */
export async function joinInvite(_: FormState, fd: FormData): Promise<FormState> {
  return limited(async () => {
    const ip = await clientIp();
    await enforce([`signup:ip:${ip}`, LIMITS.signupPerIp]);
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
    const { data, error } = await supabase.auth.signUp({
      email: invite.email,
      password,
      options: { data: { name }, emailRedirectTo: callbackUrl(`/invite/${token}`) },
    });
    if (error) return { error: friendlyAuthError(error) };
    if (!data.session || !data.user) return { ok: "Check your email for a confirmation link. It brings you back here to join." };
    const result = await acceptInviteForUser(token, { id: data.user.id, email: invite.email.toLowerCase(), name });
    if ("error" in result) return { error: result.error };
    await audit({ orgId: result.orgId, userId: data.user.id, action: "member.joined", ip });
    redirect("/app");
  });
}

/** A signed-in user (existing account) accepts an invite from its link. */
export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const user = await verifiedUser();
  if (!user) return { error: "Sign in first." };
  const result = await acceptInviteForUser(String(fd.get("token") ?? ""), user);
  if ("error" in result) return { error: result.error };
  await audit({ orgId: result.orgId, userId: user.id, action: "member.joined", ip: await clientIp() });
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

/** For a signed-in user with no workspace yet (see /no-workspace). */
export async function createWorkspace(_: FormState, fd: FormData): Promise<FormState> {
  return limited(async () => {
    const user = await verifiedUser();
    if (!user) redirect("/login");
    if (!(await signupAllowed())) return { error: "Creating workspaces is disabled. Ask your administrator for an invite." };
    const ip = await clientIp();
    await enforce([`signup:ip:${ip}`, LIMITS.signupPerIp]);

    const orgName = String(fd.get("orgName") ?? "").trim();
    if (orgName.length < 2 || orgName.length > 100) return { error: "Enter an organisation name (2 to 100 characters)." };

    const webhookSecret = randomToken(24);
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: orgName, webhookSecret, settings: DEFAULT_ORG_SETTINGS })
      .returning({ id: schema.organizations.id });
    await db.insert(schema.users).values({ id: user.id, email: user.email, name: user.name }).onConflictDoNothing();
    await db.insert(schema.memberships).values({ userId: user.id, orgId: org.id, role: "owner" }).onConflictDoNothing();
    await audit({ orgId: org.id, userId: user.id, action: "auth.signup", ip });
    await autoProvisionVoiceAgent({ id: org.id, name: orgName, webhookSecret });
    redirect("/app");
  });
}
