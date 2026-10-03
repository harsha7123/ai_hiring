import Link from "next/link";
import { ActionForm, CopyButton, SubmitButton, Uploader } from "@/components/client";
import { Badge, ButtonLink, Card, CardHeader, Empty, Notice, Stat, td, th } from "@/components/ui";
import { INTERVIEW, STAGE } from "@/lib/labels";
import { inviteLink } from "@/lib/pipeline";
import { resendInvite, retryFailed, retrySpec, scanCvLibrary, startInterviews } from "../../actions";
import { funnel, type CandidateRow, type PositionRow } from "./data";

export function Overview({
  position: p,
  rows,
  editable,
  cvPool,
}: {
  position: PositionRow;
  rows: CandidateRow[];
  editable: boolean;
  cvPool: { poolSize: number; unmatched: number };
}) {
  const f = funnel(rows);
  // Only offer "Start interviews" while the interview pool has room.
  const poolFull = rows.filter((r) => r.interviewStatus != null).length >= p.interviewPool;
  const waitingToSelect = poolFull ? 0 : rows.filter((r) => r.stage === "scored").length;
  const inPipeline = rows.filter((r) => r.interviewStatus != null);
  const processing = rows.filter((r) => r.stage === "uploaded" || (r.stage === "parsed" && p.specConfirmed)).length;

  return (
    <div className="space-y-6">
      <NextStep p={p} editable={editable} total={rows.length} waitingToSelect={waitingToSelect} processing={processing} failed={f.drop.failed} />

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Applied" value={f.applied} />
          <Stat label="Screened" value={f.screened} sub={processing ? `${processing} processing` : undefined} />
          <Stat label="Selected" value={f.selected} sub={`pool of ${p.interviewPool}`} />
          <Stat label="Consented" value={f.consented} />
          <Stat label="Interviewed" value={f.interviewed} />
          <Stat label="Shortlisted" value={f.shortlisted} sub={`target ${p.targetShortlist}`} />
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-sm text-ink-3">
          <span>Drop-off:</span>
          <DropLink id={p.id} stage="filtered_out" n={f.drop.filtered} label="filtered by fast pass or knockouts" />
          <DropLink id={p.id} stage="declined" n={f.drop.declined} label="asked for a human" />
          <DropLink id={p.id} stage="unreachable" n={f.drop.unreachable} label="unreachable" />
          <DropLink id={p.id} stage="rejected" n={f.drop.rejected} label="rejected by recruiter" />
          <DropLink id={p.id} stage="failed" n={f.drop.failed} label="processing errors" />
        </div>
      </Card>

      {editable && (
        <Card>
          <CardHeader title="Upload CVs" description="Add CVs at any time. Each is parsed, structured and scored in the background." />
          <div className="p-5">
            <Uploader positionId={p.id} />
          </div>
          {cvPool.poolSize > 0 && p.specConfirmed && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-5">
              <div>
                <p className="text-sm text-ink-2">
                  Your company&apos;s CV library has <span className="font-medium text-ink">{cvPool.poolSize}</span> CV{cvPool.poolSize === 1 ? "" : "s"} collected across all roles
                  {cvPool.unmatched > 0 ? (
                    <>
                      , <span className="font-medium text-ink">{cvPool.unmatched}</span> not yet screened for this role.
                    </>
                  ) : (
                    " — all already screened for this role."
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">Every CV anyone uploads, to any role, is kept here too, so you never have to ask someone to resend a CV you already have.</p>
              </div>
              {cvPool.unmatched > 0 && (
                <ActionForm action={scanCvLibrary}>
                  <input type="hidden" name="positionId" value={p.id} />
                  <SubmitButton variant="secondary" pendingText="Scanning…">
                    Scan company CV library
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="Interview pipeline"
          description="Consent and in-browser AI interviews. Candidates click their link, consent, and talk to the agent through their own microphone — no phone call. Non-responders are re-invited up to three times."
        />
        {inPipeline.length === 0 ? (
          <Empty title="No candidates in the interview stage yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Candidate</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Interview</th>
                  <th className={th}>Note</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {inPipeline.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      <Link href={`/app/positions/${p.id}/candidates/${r.id}`} className="font-medium hover:underline">
                        {r.name ?? r.fileName}
                      </Link>
                      <div className="text-xs text-ink-3">{r.phone ?? "no phone"}</div>
                    </td>
                    <td className={td}>
                      <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge>
                    </td>
                    <td className={`${td} text-ink-2`}>
                      {INTERVIEW[r.interviewStatus!]}
                      {r.interviewAttempts ? <span className="text-ink-3"> · {r.interviewAttempts} attempt{r.interviewAttempts > 1 ? "s" : ""}</span> : null}
                    </td>
                    <td className={`${td} max-w-xs text-xs text-ink-3`}>{r.interviewError ?? r.error ?? r.stageReason ?? ""}</td>
                    <td className={`${td} text-right`}>
                      {editable && r.inviteToken && ["selected", "invited", "unreachable"].includes(r.stage) && (
                        <div className="flex justify-end gap-2">
                          <CopyButton value={inviteLink(r.inviteToken)} label="Copy invite link" />
                          <form action={resendInvite}>
                            <input type="hidden" name="candidateId" value={r.id} />
                            <SubmitButton variant="ghost" size="sm">
                              Resend
                            </SubmitButton>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function DropLink({ id, stage, n, label }: { id: string; stage: string; n: number; label: string }) {
  if (!n) return null;
  return (
    <Link href={`/app/positions/${id}?tab=candidates&stage=${stage}`} className="hover:text-ink">
      <span className="tabular font-medium text-ink-2">{n}</span> {label}
    </Link>
  );
}

function NextStep({ p, editable, total, waitingToSelect, processing, failed }: { p: PositionRow; editable: boolean; total: number; waitingToSelect: number; processing: number; failed: number }) {
  if (!p.spec && !p.specError) return <Notice tone="info">Reading the job description and extracting the requirement spec…</Notice>;
  if (p.specError)
    return (
      <Notice tone="bad">
        <div className="flex items-center justify-between gap-4">
          <span>Requirement extraction failed: {p.specError}</span>
          {editable && (
            <form action={retrySpec}>
              <input type="hidden" name="positionId" value={p.id} />
              <SubmitButton size="sm" variant="secondary">
                Retry
              </SubmitButton>
            </form>
          )}
        </div>
      </Notice>
    );
  if (!p.specConfirmed)
    return (
      <Notice tone="warn">
        <div className="flex items-center justify-between gap-4">
          <span>Review the extracted requirements and confirm them. CVs are only scored against a confirmed spec.</span>
          <ButtonLink href={`/app/positions/${p.id}?tab=requirements`} size="sm">
            Review requirements
          </ButtonLink>
        </div>
      </Notice>
    );
  return (
    <div className="space-y-3">
      {failed > 0 && editable && (
        <Notice tone="bad">
          <div className="flex items-center justify-between gap-4">
            <span>{failed} CVs could not be processed.</span>
            <form action={retryFailed}>
              <input type="hidden" name="positionId" value={p.id} />
              <SubmitButton size="sm" variant="secondary">
                Retry failed
              </SubmitButton>
            </form>
          </div>
        </Notice>
      )}
      {total === 0 ? (
        <Notice>Requirements confirmed. Upload the CV pile below to start ranking.</Notice>
      ) : waitingToSelect > 0 && editable ? (
        <Card className="p-5">
          <ActionForm action={startInterviews} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <input type="hidden" name="positionId" value={p.id} />
            <div>
              <p className="font-medium text-ink">
                {waitingToSelect} ranked candidates are ready{processing ? `, ${processing} still processing` : ""}.
              </p>
              <p className="mt-0.5 text-sm text-ink-3">
                Review the ranking first. Starting sends the top candidates (up to the pool of {p.interviewPool}) a link to an in-browser AI interview they can take whenever they’re ready.
              </p>
            </div>
            <SubmitButton pendingText="Selecting…" confirm="Invite the top-ranked candidates to the AI interview?">
              Start interviews
            </SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
