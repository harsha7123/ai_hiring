import "server-only";
import { redirect } from "next/navigation";
import { readSession } from "./session";

export type Role = "owner" | "admin" | "recruiter" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, recruiter: 1, admin: 2, owner: 3 };

export type Ctx = NonNullable<Awaited<ReturnType<typeof readSession>>>;

export const can = (role: Role, min: Role) => RANK[role] >= RANK[min];

/** For pages: redirects to /login when signed out, back to /app when under-privileged. */
export async function requirePage(min: Role = "viewer"): Promise<Ctx> {
  const ctx = await readSession();
  if (!ctx) redirect("/login");
  if (!can(ctx.role, min)) redirect("/app");
  return ctx;
}

export class AuthError extends Error {}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireAction(min: Role = "recruiter"): Promise<Ctx> {
  const ctx = await readSession();
  if (!ctx) throw new AuthError("Not signed in");
  if (!can(ctx.role, min)) throw new AuthError("You do not have permission to do that");
  return ctx;
}
