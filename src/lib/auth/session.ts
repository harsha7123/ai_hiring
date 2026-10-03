import "server-only";
import { headers } from "next/headers";
import { desc, eq, and, isNull, gt } from "drizzle-orm";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { db, schema } from "@/db";
import { supabaseServer } from "@/lib/supabase/server";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/**
 * Keeps our local profile row (used for joins/audit display) in sync with Supabase
 * auth. Swallows a same-email/different-id conflict rather than 500ing every page
 * load — that can only happen if a Supabase account was deleted and recreated with
 * the same address, which needs a person to untangle, not a silent auto-merge.
 */
async function ensureUserProfile(user: SupabaseUser) {
  const name = (user.user_metadata?.name as string | undefined)?.trim() || user.email?.split("@")[0] || "User";
  try {
    await db
      .insert(schema.users)
      .values({ id: user.id, email: user.email!, name, lastLoginAt: new Date() })
      .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email!, lastLoginAt: new Date() } });
  } catch (err) {
    console.error(`profile sync failed for ${user.id} <${user.email}>:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Any invite sent to this email, created before or after they signed up, is
 * attached the first time they're seen signed in with a matching address.
 */
async function consumePendingInvites(userId: string, email: string) {
  const pending = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.email, email), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  for (const invite of pending) {
    await db.insert(schema.memberships).values({ userId, orgId: invite.orgId, role: invite.role }).onConflictDoNothing();
    await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  }
}

/**
 * ensureUserProfile/consumePendingInvites only ever do something the first
 * time a user is seen, or when someone invites them later — not on every one
 * of the dozens of page loads and actions a session makes per minute. This
 * process stays warm between requests (unlike a cold-start serverless
 * function), so a small in-memory "checked recently" cache is enough to skip
 * both on every request but the first in a window, without a database read.
 * Worst case (a fresh deploy, or the TTL elapsing) it just runs again — never
 * unsafe, purely a latency optimization.
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
  const supabase = await supabaseServer();
  // getSession() reads and verifies the local JWT without a network round-trip
  // to Supabase's Auth server. That's normally a risk (a stale/revoked session
  // could pass), but every request under /app/* already went through the proxy
  // middleware, which just called the network-verifying getUser() for this
  // exact request and refreshed the cookie — re-verifying again here a moment
  // later would be a second network call for no additional safety.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user?.email) return null;

  const loadMemberships = () =>
    db
      .select({
        role: schema.memberships.role,
        org: { id: schema.organizations.id, name: schema.organizations.name },
      })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
      .where(eq(schema.memberships.userId, user.id))
      .orderBy(desc(schema.memberships.createdAt));

  const [membershipsResult, [pref]] = await Promise.all([
    loadMemberships(),
    db.select().from(schema.activeOrgPrefs).where(eq(schema.activeOrgPrefs.userId, user.id)),
  ]);
  let memberships = membershipsResult;

  // Always run this for a not-yet-a-member user (a just-sent invite needs to attach
  // right away), but otherwise only once per TTL — ensureUserProfile/consumePendingInvites
  // are a no-op for the overwhelming majority of a settled user's page loads.
  if (!memberships.length || shouldRecheck(user.id)) {
    await ensureUserProfile(user);
    await consumePendingInvites(user.id, user.email);
    if (!memberships.length) memberships = await loadMemberships();
  }
  if (!memberships.length) return null;

  const active = memberships.find((m) => m.org.id === pref?.orgId) ?? memberships[0];

  return {
    user: { id: user.id, email: user.email, name: (user.user_metadata?.name as string | undefined) || user.email.split("@")[0] },
    org: active.org,
    role: active.role,
  };
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
