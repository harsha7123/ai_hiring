import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Evidence } from "@/db/schema";
import { can, requirePage } from "@/lib/auth/guard";
import { ActionForm, AutoRefresh, PrintButton, SubmitButton } from "@/components/client";
import { Badge, Card, CardHeader, Notice, PageHeader, Textarea, buttonClass, cx, td, th } from "@/components/ui";
import { INTERVIEW, RECOMMENDATION, STAGE, fmtDate } from "@/lib/labels";
import { deleteCandidate, promoteCandidate, rejectCandidate, submitTranscript } from "../../../../actions";
import { loadPosition } from "../../data";

export const metadata: Metadata = { title: "Candidate report" };

const SUBSTANTIATED = {
  yes: { label: "Substantiated", tone: "good" },
  partly: { label: "Partly", tone: "warn" },
  no: { label: "Not substantiated", tone: "bad" },
  not_probed: { label: "Not probed", tone: "neutral" },
} as const;

export default async function CandidatePage({ params }: PageProps<"/app/positions/[id]/candidates/[cid]">) {
  const ctx = await requirePage();
  const { id, cid } = await params;
  const position = await loadPosition(ctx.org.id, id);
  if (!/^[0-9a-f-]{36}$/i.test(cid)) notFound();
  const [c] = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, cid), eq(schema.candidates.orgId, ctx.org.id), eq(schema.candidates.positionId, id)));
  if (!c) notFound();
  const [iv] = await db.select().from(schema.interviews).where(eq(schema.interviews.candidateId, c.id));
  const [report] = await db.select().from(schema.reports).where(eq(schema.reports.candidateId, c.id));
  const r = report?.content;
  const editable = can(ctx.role, "recruiter");
  const busy = c.stage === "uploaded" || (iv?.status === "completed" && c.interviewScore == null);

  return (
    <div className="mx-auto max-w-5xl">
      <AutoRefresh active={busy} />
      <PageHeader
        eyebrow={
          <Link href={`/app/positions/${id}?tab=candidates`} className="hover:text-ink">
            {position.title}
          </Link>
        }
        title={c.name ?? c.fileName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STAGE[c.stage].tone}>{STAGE[c.stage].label}</Badge>
            {c.finalRank && <span>Rank #{c.finalRank}</span>}
            {c.stageReason && <span className="text-ink-3">· {c.stageReason}</span>}
          </span>
        }
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <PrintButton />
            <a href={`/api/candidates/${c.id}/cv`} className={buttonClass({ variant: "secondary" })}>
              Original CV
            </a>
            {editable && !c.promoted && ["scored", "filtered_out", "rejected", "reserve", "parsed"].includes(c.stage) && (
              <form action={promoteCandidate}>
                <input type="hidden" name="candidateId" value={c.id} />
                <SubmitButton variant="secondary">Promote</SubmitButton>
              </form>
            )}
            {editable && !["rejected", "failed", "uploaded"].includes(c.stage) && (
              <form action={rejectCandidate}>
                <input type="hidden" name="candidateId" value={c.id} />
                <SubmitButton variant="danger" confirm="Reject this candidate?">
                  Reject
                </SubmitButton>
              </form>
            )}
          </div>
        }
      />

      {c.error && (
        <div className="mb-6">
          <Notice tone="bad">{c.error}</Notice>
        </div>
      )}

      <div className="space-y-6">
        {r ? (
          <Card className="print-break p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={RECOMMENDATION[r.recommendation].tone} className="px-2.5 py-1 text-sm">
                {RECOMMENDATION[r.recommendation].label}
              </Badge>
              <span className="text-sm text-ink-3">Recommendation · decision remains with your panel</span>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-ink">{r.summary}</p>
          </Card>
        ) : (
          <Notice tone="info">
            {iv?.status === "completed" ? "Scoring the interview and writing the report…" : "The full report is produced after the AI interview. CV assessment is shown below."}
          </Notice>
        )}

        <Card className="print-break">
          <CardHeader title="Scores" />
          <div className="grid gap-px bg-line sm:grid-cols-3">
            <ScoreCell label="CV score" value={c.cvScore} />
            <ScoreCell label="Interview score" value={c.interviewScore} />
            <ScoreCell label="Final score" value={c.finalScore} sub={c.finalRank ? `Rank #${c.finalRank} · CV weight ${Math.round(position.config.cvWeight * 100)}%` : undefined} />
          </div>
          <div className="grid gap-6 border-t border-line p-5 md:grid-cols-2">
            <DimensionList title="CV rubric" dims={c.assessment?.dimensions} />
            <DimensionList title="Interview rubric" dims={iv?.assessment?.dimensions} />
          </div>
        </Card>

        {r && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="print-break">
              <CardHeader title="Strengths" />
              <ul className="divide-y divide-line">
                {r.strengths.map((s, i) => (
                  <Point key={i} title={s.title} detail={s.detail} evidence={s.evidence} />
                ))}
                {r.strengths.length === 0 && <li className="p-5 text-sm text-ink-3">No evidenced strengths.</li>}
              </ul>
            </Card>
            <Card className="print-break">
              <CardHeader title="Concerns" />
              <ul className="divide-y divide-line">
                {r.concerns.map((s, i) => (
                  <Point key={i} title={s.title} detail={s.detail} evidence={s.evidence} />
                ))}
                {r.noConcernsStatement && <li className="p-5 text-sm text-ink-2">{r.noConcernsStatement}</li>}
              </ul>
            </Card>
          </div>
        )}

        {iv?.assessment && (
          <Card className="print-break">
            <CardHeader title="Skill verification" description="For each must-have: claimed on the CV, probed in the interview, and whether the answer substantiated it." />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th}>Skill</th>
                    <th className={th}>On CV</th>
                    <th className={th}>Probed</th>
                    <th className={th}>Result</th>
                    <th className={th}>Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {iv.assessment.skillVerification.map((s) => (
                    <tr key={s.skill}>
                      <td className={`${td} font-medium`}>{s.skill}</td>
                      <td className={td}>{s.claimedOnCv ? "Yes" : "No"}</td>
                      <td className={td}>{s.probed ? "Yes" : "No"}</td>
                      <td className={td}>
                        <Badge tone={SUBSTANTIATED[s.substantiated].tone}>{SUBSTANTIATED[s.substantiated].label}</Badge>
                      </td>
                      <td className={`${td} max-w-md text-ink-2`}>{s.evidence ? <q className="italic">{s.evidence}</q> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {(iv?.assessment || r) && (
          <div className="grid gap-6 md:grid-cols-2">
            {iv?.assessment && (
              <Card className="print-break">
                <CardHeader title="Logistics" description="As stated by the candidate on the call" />
                <dl className="divide-y divide-line text-sm">
                  {(
                    [
                      ["Notice period", iv.assessment.logistics.noticePeriod],
                      ["Compensation expectation", iv.assessment.logistics.compensation],
                      ["Location", iv.assessment.logistics.location],
                      ["Shift willingness", iv.assessment.logistics.shiftWillingness],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-5 gap-4 px-5 py-3">
                      <dt className="col-span-2 text-ink-3">{k}</dt>
                      <dd className="col-span-3 text-ink">{v ?? <span className="text-ink-3">Not discussed</span>}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
            {r && (
              <Card className="print-break">
                <CardHeader title="Suggested probes for the panel" />
                <ol className="list-decimal space-y-2 py-4 pl-10 pr-5 text-sm text-ink">
                  {r.suggestedProbes.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
              </Card>
            )}
          </div>
        )}

        {c.assessment && (
          <Card className="print-break">
            <CardHeader title="CV assessment" description={c.assessment.summary} />
            <div className="flex flex-wrap gap-2 p-5">
              {c.assessment.mustHaveCoverage.map((m) => (
                <Badge key={m.skill} tone={m.present ? "good" : "neutral"}>
                  {m.present ? "✓" : "–"} {m.skill}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        <Card className="no-print">
          <CardHeader
            title="Interview"
            description={
              iv
                ? `${INTERVIEW[iv.status]} · ${iv.attempts} dial${iv.attempts === 1 ? "" : "s"}${iv.completedAt ? ` · completed ${fmtDate(iv.completedAt)}` : ""}${iv.durationSec ? ` · ${Math.round(iv.durationSec / 60)} min` : ""}`
                : "Not selected for interview"
            }
          />
          <div className="space-y-5 p-5">
            {c.consentAt && (
              <p className="text-sm text-ink-2">
                Consent recorded {fmtDate(c.consentAt)}
                {c.consentIp && <span className="text-ink-3"> from {c.consentIp}</span>}.
              </p>
            )}
            {iv?.lastError && <Notice tone="warn">{iv.lastError}</Notice>}
            {iv?.questions && (
              <div>
                <h3 className="text-sm font-medium">Planned questions (generated for this candidate)</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
                  {iv.questions.map((q, i) => (
                    <li key={i}>
                      {q.question} <span className="text-ink-3">— {q.purpose}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {iv?.recordingUrl && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Call recording</h3>
                <audio controls preload="none" src={iv.recordingUrl} className="w-full" />
              </div>
            )}
            {iv?.transcript && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Full transcript</summary>
                <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-4 font-sans text-sm leading-relaxed text-ink-2">
                  {iv.transcript}
                </pre>
              </details>
            )}
            {editable && iv && iv.status !== "completed" && (
              <details className="rounded-lg border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium">Record an interview manually</summary>
                <p className="mt-2 text-sm text-ink-3">For a candidate who asked for a human interviewer, paste the transcript here. It is scored with the same rubric.</p>
                <ActionForm action={submitTranscript} className="mt-3 space-y-3">
                  <input type="hidden" name="candidateId" value={c.id} />
                  <Textarea name="transcript" rows={8} placeholder={"Interviewer: ...\nCandidate: ..."} required />
                  <SubmitButton size="sm">Score transcript</SubmitButton>
                </ActionForm>
              </details>
            )}
          </div>
        </Card>

        <Card className="no-print">
          <CardHeader title="Original CV text" />
          <details className="p-5">
            <summary className="cursor-pointer text-sm font-medium">Show extracted text</summary>
            <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-4 font-sans text-sm leading-relaxed text-ink-2">{c.cvText ?? "Not yet extracted."}</pre>
          </details>
        </Card>

        <p className="text-xs text-ink-3">
          Every strength and concern quotes its source. Claims the model made without a verifiable quote are removed before the report is released
          {r?.droppedUnsupportedClaims ? ` (${r.droppedUnsupportedClaims} removed for this report)` : ""}. Scoring excluded name, gender, age, religion, caste, marital status and photographs.
          {report && ` Generated ${fmtDate(report.createdAt)} by ${report.model}.`}
        </p>

        {can(ctx.role, "admin") && (
          <form action={deleteCandidate} className="no-print border-t border-line pt-6">
            <input type="hidden" name="candidateId" value={c.id} />
            <SubmitButton variant="danger" size="sm" confirm="Delete this candidate's CV, transcript, recording link and all scores? Use this for data-deletion requests. This cannot be undone.">
              Delete candidate data
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

function ScoreCell({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="tabular mt-1 text-3xl font-semibold">{value == null ? "—" : Math.round(value)}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function DimensionList({ title, dims }: { title: string; dims?: { name: string; score: number; rationale: string; evidence: string[] }[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {!dims ? (
        <p className="mt-2 text-sm text-ink-3">Not yet assessed.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {dims.map((d) => (
            <li key={d.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink">{d.name}</span>
                <span className="tabular text-ink-2">{d.score}/10</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
                <div className="h-full bg-ink" style={{ width: `${d.score * 10}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-ink-3">{d.rationale}</p>
              {d.evidence.map((q, i) => (
                <blockquote key={i} className="mt-1.5 border-l-2 border-line-2 pl-3 text-xs italic text-ink-2">
                  {q}
                </blockquote>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Point({ title, detail, evidence }: { title: string; detail: string; evidence: Evidence }) {
  return (
    <li className="p-5">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{detail}</p>
      <blockquote className={cx("mt-3 border-l-2 pl-3 text-sm italic text-ink-2", evidence.source === "cv" ? "border-info" : "border-ink")}>
        “{evidence.quote}”
        <span className="mt-1 block text-xs not-italic text-ink-3">{evidence.source === "cv" ? "From the CV" : "From the interview transcript"}</span>
      </blockquote>
    </li>
  );
}
