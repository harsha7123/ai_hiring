import Link from "next/link";
import type { Metadata } from "next";
import { can, requirePage } from "@/lib/auth/guard";
import { AutoRefresh } from "@/components/client";
import { Badge, cx, PageHeader } from "@/components/ui";
import { isBusy, loadCandidates, loadCvPoolStats, loadPosition } from "./data";
import { Overview } from "./overview";
import { Requirements } from "./requirements";
import { Candidates } from "./candidates";
import { Shortlist } from "./shortlist";
import { PositionSettings } from "./settings";

export const metadata: Metadata = { title: "Role" };

const TABS = [
  ["overview", "Overview"],
  ["requirements", "Requirements"],
  ["candidates", "Candidates"],
  ["shortlist", "Shortlist"],
  ["settings", "Settings"],
] as const;

export default async function PositionPage({ params, searchParams }: PageProps<"/app/positions/[id]">) {
  const ctx = await requirePage();
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "overview";
  const position = await loadPosition(ctx.org.id, id);
  const rows = await loadCandidates(ctx.org.id, id);
  const editable = can(ctx.role, "recruiter");
  const cvPool = tab === "overview" ? await loadCvPoolStats(ctx.org.id, id) : null;

  return (
    <>
      <AutoRefresh active={isBusy(position, rows)} />
      <PageHeader
        eyebrow={<Link href="/app" className="hover:text-ink">Roles</Link>}
        title={
          <span className="flex items-center gap-3">
            {position.title}
            <Badge tone={position.status === "completed" ? "good" : position.status === "draft" ? "neutral" : "info"}>{position.status}</Badge>
          </span>
        }
        description={position.location ?? undefined}
      />
      <nav className="no-print mb-8 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/app/positions/${id}?tab=${key}`}
            className={cx(
              "-mb-px border-b-2 px-3 pb-3 pt-1 text-sm whitespace-nowrap",
              tab === key ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {label}
            {key === "requirements" && position.spec && !position.specConfirmed && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warn align-middle" />
            )}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview position={position} rows={rows} editable={editable} cvPool={cvPool!} />}
      {tab === "requirements" && <Requirements position={position} editable={editable} />}
      {tab === "candidates" && <Candidates position={position} rows={rows} editable={editable} stage={typeof sp.stage === "string" ? sp.stage : undefined} />}
      {tab === "shortlist" && <Shortlist position={position} rows={rows} />}
      {tab === "settings" && <PositionSettings position={position} editable={editable} isAdmin={can(ctx.role, "admin")} />}
    </>
  );
}
