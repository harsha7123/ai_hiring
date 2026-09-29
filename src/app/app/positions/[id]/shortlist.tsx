import Link from "next/link";
import { Badge, Card, CardHeader, Empty, ScoreBar, buttonClass, td, th } from "@/components/ui";
import { RECOMMENDATION } from "@/lib/labels";
import type { CandidateRow, PositionRow } from "./data";

export function Shortlist({ position: p, rows }: { position: PositionRow; rows: CandidateRow[] }) {
  const shortlist = rows.filter((r) => r.stage === "shortlisted").sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0));
  const reserve = rows.filter((r) => r.stage === "reserve").sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Shortlist · ${shortlist.length} of ${p.targetShortlist}`}
          description="Ranked by combined CV and interview score. Open a candidate for the full evidence-backed report."
          action={
            <a href={`/api/positions/${p.id}/export`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              Export CSV
            </a>
          }
        />
        <RankTable id={p.id} rows={shortlist} empty="No one is shortlisted yet. Candidates appear here as their interviews are scored." />
      </Card>
      {reserve.length > 0 && (
        <Card>
          <CardHeader title={`Reserve pool · ${reserve.length}`} description="Interviewed candidates ranked below the shortlist, available if a finalist drops out." />
          <RankTable id={p.id} rows={reserve} empty="" />
        </Card>
      )}
    </div>
  );
}

function RankTable({ id, rows, empty }: { id: string; rows: CandidateRow[]; empty: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-line">
          <tr>
            <th className={th}>Rank</th>
            <th className={th}>Candidate</th>
            <th className={th}>Recommendation</th>
            <th className={th}>CV</th>
            <th className={th}>Interview</th>
            <th className={th}>Final</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-sunken/40">
              <td className={`${td} tabular font-medium`}>{r.finalRank}</td>
              <td className={td}>
                <Link href={`/app/positions/${id}/candidates/${r.id}`} className="font-medium hover:underline">
                  {r.name ?? r.fileName}
                </Link>
                {r.promoted && <span className="ml-2 text-xs text-info">promoted</span>}
              </td>
              <td className={td}>{r.recommendation && <Badge tone={RECOMMENDATION[r.recommendation].tone}>{RECOMMENDATION[r.recommendation].label}</Badge>}</td>
              <td className={td}>
                <ScoreBar value={r.cvScore} />
              </td>
              <td className={td}>
                <ScoreBar value={r.interviewScore} />
              </td>
              <td className={td}>
                <ScoreBar value={r.finalScore} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
