import "server-only";
import { headers } from "next/headers";
import { desc, eq, and, isNull, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { ipFromHeaders } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return ipFromHeaders((n) => h.get(n));
}

export type AuthUser = { id: string; email: string; name: string };

/**
 * The signed-in user, from a cryptographically verified JWT. getClaims()
 * checks the token's signature (locally against the project's JWKS for
 * asymmetric signing keys, or via the Auth server for legacy symmetric ones),
 * unlike getSession(), which trusts whatever the cookie says. That matters
 * because not every route goes through the proxy â€” /api/* route handlers
 * read the cookie directly, so this check is the only thing standing between
 * a forged cookie and tenant data.
 */
export async function verifiedUser(): Promise<AuthUser | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || typeof claims.email !== "string" || !claims.email) return null;
  const meta = (claims.user_metadata ?? {}) as { name?: unknown };
  const name = (typeof meta.name === "string" && meta.name.trim()) || claims.email.split("@")[0];
  return { id: claims.sub, email: claims.email.toLowerCase(), name };
}

/**
 * Keeps our local profile row (used for joins/audit display) in sync with Supabase
 * auth. Swallows a same-email/different-id conflict rather than 500ing every page
 * load â€” that can only happen if a Supabase account was deleted and recreated with
 * the same address, which needs a person to untangle, not a silent auto-merge.
 */
export async function ensureUserProfile(user: AuthUser) {
  try {
    await db
      .insert(schema.users)
      .values({ id: user.id, email: user.email, name: user.name, lastLoginAt: new Date() })
      .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email, lastLoginAt: new Date() } });
  } catch (err) {
    log.warn("profile sync failed", { userId: user.id, err });
  }
}

/**
 * Accepts a team invite for a signed-in user. Requires both the invite token
 * (proof the person was actually sent the link) and a verified session for the
 * invited email. Matching on email alone is not enough: with email
 * confirmation turned off in Supabase, anyone can create an account for any
 * address, so an email match proves nothing about who is holding it.
 */
export async function acceptInviteForUser(token: string, user: AuthUser): Promise<{ orgId: string } | { error: string }> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  if (!invite) return { error: "This invitation is invalid, already used, or has expired." };
  if (invite.email.toLowerCase() !== user.email) {
    return { error: `This invitation is for ${invite.email}, but you're signed in as ${user.email}.` };
  }
  await ensureUserProfile(user);
  await db.insert(schema.memberships).values({ userId: user.id, orgId: invite.orgId, role: invite.role }).onConflictDoNothing();
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  await switchSessionOrg(user.id, invite.orgId);
  return { orgId: invite.orgId };
}

/**
 * ensureUserProfile only does something the first time a user is seen â€” not on
 * every one of the dozens of page loads and actions a session makes per minute.
 * This process stays warm between requests (unlike a cold-start serverless
 * function), so a small in-memory "checked recently" cache is enough to skip it
 * on every request but the first in a window, without a database read. Worst
 * case (a fresh deploy, or the TTL elapsing) it just runs again â€” never unsafe,
 * purely a latency optimization.
 */
const recentlyChecked = new Map<string, number>();
const CHECK_TTL_MS = 3 * 60_000;

function shouldRecheck(userId: string): boolean {
  const last = recentlyChecked.get(userId);
  const now = Date.now();
  if (last && now - last < CHECK_TTL_MS) return false;
  recentlyChecked.set(userId, now);
  if (recentlyChecked.size > 5000) {
    // Cheap unbounded-growth guard for a long-lived process with many distinct users.
    const cutoff = now - CHECK_TTL_MS;
    for (const [id, t] of recentlyChecked) if (t < cutoff) recentlyChecked.delete(id);
  }
  return true;
}

export async function readSession() {
  const user = await verifiedUser();
  if (!user) return null;

  const [memberships, [pref]] = await Promise.all([
    db
      .select({
        role: schema.memberships.role,
        org: { id: schema.organizations.id, name: schema.organizations.name },
      })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
      .where(eq(schema.memberships.userId, user.id))
      .orderBy(desc(schema.memberships.createdAt)),
    db.select().from(schema.activeOrgPrefs).where(eq(schema.activeOrgPrefs.userId, user.id)),
  ]);

  if (shouldRecheck(user.id)) await ensureUserProfile(user);
  if (!memberships.length) return null;

  const active = memberships.find((m) => m.org.id === pref?.orgId) ?? memberships[0];

  return { user, org: active.org, role: active.role };
}

export async function destroySession() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}

export async function switchSessionOrg(userId: string, orgId: string) {
  await db
    .insert(schema.activeOrgPrefs)
    .values({ userId, orgId })
    .onConflictDoUpdate({ target: schema.activeOrgPrefs.userId, set: { orgId, updatedAt: new Date() } });
}
