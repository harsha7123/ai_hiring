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

export async function readSession() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  await ensureUserProfile(user);
  await consumePendingInvites(user.id, user.email);

  const memberships = await db
    .select({
      role: schema.memberships.role,
      org: { id: schema.organizations.id, name: schema.organizations.name },
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(desc(schema.memberships.createdAt));
  if (!memberships.length) return null;

  const [pref] = await db.select().from(schema.activeOrgPrefs).where(eq(schema.activeOrgPrefs.userId, user.id));
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
