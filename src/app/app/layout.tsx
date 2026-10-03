import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Logo } from "@/components/brand";
import { can, requirePage } from "@/lib/auth/guard";
import { isDemoMode } from "@/lib/ai/client";
import { logout, switchOrg } from "../(auth)/actions";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const ctx = await requirePage();
  const orgs = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, ctx.user.id));
  const aiMissing = !isDemoMode() && !process.env.OPENAI_API_KEY;

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Logo href="/app" />
          <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
            <NavLink href="/app">Roles</NavLink>
            {can(ctx.role, "admin") && <NavLink href="/app/settings">Settings</NavLink>}
            {can(ctx.role, "admin") && <NavLink href="/app/audit">Audit</NavLink>}
          </nav>
          <div className="ml-auto flex min-w-0 shrink items-center gap-2 sm:gap-3">
            {orgs.length > 1 ? (
              <form action={switchOrg} className="flex min-w-0 items-center">
                <select
                  name="orgId"
                  defaultValue={ctx.org.id}
                  className="h-8 w-24 min-w-0 rounded-lg border border-line-2 bg-surface px-2 text-sm sm:w-auto sm:max-w-[12rem]"
                  aria-label="Switch organisation"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button className="ml-1 h-8 shrink-0 rounded-lg px-2 text-sm text-ink-2 hover:bg-sunken">Switch</button>
              </form>
            ) : (
              <span className="hidden truncate text-sm text-ink-2 sm:inline">{ctx.org.name}</span>
            )}
            <span className="hidden h-4 w-px bg-line-2 sm:inline" />
            <span className="hidden text-sm text-ink-3 md:inline" title={ctx.user.email}>
              {ctx.user.name} · {ctx.role}
            </span>
            <form action={logout}>
              <button className="h-8 whitespace-nowrap rounded-lg px-2 text-sm text-ink-2 hover:bg-sunken hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {isDemoMode() && (
        <div className="no-print border-b border-line bg-warn-bg px-6 py-2 text-center text-xs text-warn">
          Demo mode: scoring uses simple heuristics, not the AI model. Set OPENAI_API_KEY and AI_DEMO_MODE=false for production.
        </div>
      )}
      {aiMissing && (
        <div className="no-print border-b border-line bg-bad-bg px-6 py-2 text-center text-xs text-bad">
          OPENAI_API_KEY is not configured. CV scoring and reports will fail until it is set.
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-ink-2 hover:bg-sunken hover:text-ink sm:px-2.5">
      {children}
    </Link>
  );
}
