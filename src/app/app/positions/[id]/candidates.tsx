import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Badge, Card, Empty, ScoreBar, cx, td, th } from "@/components/ui";
import { RECOMMENDATION, STAGE } from "@/lib/labels";
import { promoteCandidate, rejectCandidate } from "../../actions";
import type { CandidateRow, PositionRow } from "./data";

const FILTERS: [string, string, (r: CandidateRow) => boolean][] = [
  ["all", "All", () => true],
  ["ranked", "Ranked", (r) => r.stage === "scored"],
  ["interview", "Interview stage", (r) => ["selected", "invited", "consented", "interviewed"].includes(r.stage)],
  ["shortlisted", "Shortlisted", (r) => r.stage === "shortlisted"],
  ["reserve", "Reserve", (r) => r.stage === "reserve"],
  ["filtered_out", "Filtered out", (r) => r.stage === "filtered_out"],
  ["declined", "Wants human", (r) => r.stage === "declined"],
  ["unreachable", "Unreachable", (r) => r.stage === "unreachable"],
  ["rejected", "Rejected", (r) => r.stage === "rejected"],
  ["failed", "Errors", (r) => r.stage === "failed"],
];

export function Candidates({ position: p, rows, editable, stage }: { position: PositionRow; rows: CandidateRow[]; editable: boolean; stage?: string }) {
  const active = FILTERS.find(([k]) => k === stage) ?? FILTERS[0];
  const visible = rows.filter(active[2]);
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap gap-1.5">
        {FILTERS.map(([key, label, fn]) => {
          const n = rows.filter(fn).length;
          if (!n && key !== "all") return null;
          return (
            <Link
              key={key}
              href={`/app/positions/${p.id}?tab=candidates&stage=${key}`}
              className={cx(
                "rounded-lg border px-3 py-1.5 text-sm",
                active[0] === key ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-2 hover:bg-sunken",
              )}
            >
              {label} <span className={cx("tabular", active[0] === key ? "text-white/70" : "text-ink-3")}>{n}</span>
            </Link>
          );
        })}
      </div>
      <Card>
        {visible.length === 0 ? (
          <Empty title="No candidates here" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Candidate</th>
                  <th className={th}>Stage</th>
                  <th className={th} title="Fast pass: requirement keyword coverage">Match</th>
                  <th className={th}>CV score</th>
                  <th className={th}>Interview</th>
                  <th className={th}>Final</th>
                  <th className={th}>Recommendation</th>
                  {editable && <th className={th} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r, i) => (
                  <tr key={r.id} className="hover:bg-sunken/40">
                    <td className={`${td} tabular text-ink-3`}>{r.finalRank ?? i + 1}</td>
                    <td className={td}>
                      <Link href={`/app/positions/${p.id}/candidates/${r.id}`} className="font-medium hover:underline">
                        {r.name ?? r.fileName}
                      </Link>
                      {r.promoted && <span className="ml-2 text-xs text-info">promoted</span>}
                      {(r.stageReason || r.error) && <div className="max-w-sm truncate text-xs text-ink-3">{r.error ?? r.stageReason}</div>}
                    </td>
                    <td className={td}>
                      <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge>
                    </td>
                    <td className={`${td} tabular text-ink-3`}>{r.lexicalScore == null ? "—" : `${Math.round(r.lexicalScore)}%`}</td>
                    <td className={td}>
                      <ScoreBar value={r.cvScore} />
                    </td>
                    <td className={td}>
                      <ScoreBar value={r.interviewScore} />
                    </td>
                    <td className={td}>
                      <ScoreBar value={r.finalScore} />
                    </td>
                    <td className={td}>
                      {r.recommendation ? <Badge tone={RECOMMENDATION[r.recommendation].tone}>{RECOMMENDATION[r.recommendation].label}</Badge> : <span className="text-ink-3">—</span>}
                    </td>
                    {editable && (
                      <td className={`${td} text-right`}>
                        <div className="flex justify-end gap-1">
                          {["scored", "filtered_out", "rejected", "reserve", "parsed"].includes(r.stage) && !r.promoted && (
                            <form action={promoteCandidate}>
                              <input type="hidden" name="candidateId" value={r.id} />
                              <SubmitButton variant="ghost" size="sm">
                                Promote
                              </SubmitButton>
                            </form>
                          )}
                          {!["rejected", "failed", "uploaded"].includes(r.stage) && (
                            <form action={rejectCandidate}>
                              <input type="hidden" name="candidateId" value={r.id} />
                              <SubmitButton variant="ghost" size="sm" confirm="Reject this candidate? You can promote them again later.">
                                Reject
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-ink-3">
        The platform ranks and recommends; it never rejects. Promote sends a candidate straight to the interview stage (or to the top of the shortlist from reserve).
      </p>
    </div>
  );
}
