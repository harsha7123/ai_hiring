import { ActionForm, SubmitButton } from "@/components/client";
import { Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { deletePosition, savePositionConfig, setPositionStatus } from "../../actions";
import type { PositionRow } from "./data";

export function PositionSettings({ position: p, editable, isAdmin, phoneAvailable }: { position: PositionRow; editable: boolean; isAdmin: boolean; phoneAvailable: boolean }) {
  const c = p.config;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Scoring and targets" description="Changing knockouts re-scores every CV. Changing weights re-ranks interviewed candidates." />
        <ActionForm action={savePositionConfig} className="p-5">
          <fieldset disabled={!editable} className="space-y-5">
            <input type="hidden" name="positionId" value={p.id} />
            <Field label="Role title" htmlFor="title">
              <Input id="title" name="title" defaultValue={p.title} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Shortlist size" htmlFor="targetShortlist">
                <Input id="targetShortlist" name="targetShortlist" type="number" min={1} defaultValue={p.targetShortlist} />
              </Field>
              <Field label="Interview pool" htmlFor="interviewPool">
                <Input id="interviewPool" name="interviewPool" type="number" min={1} defaultValue={p.interviewPool} />
              </Field>
              <Field label="Interview spend cap" htmlFor="maxInterviews" hint="Hard ceiling on interview sessions, including restarts.">
                <Input id="maxInterviews" name="maxInterviews" type="number" min={1} defaultValue={p.maxInterviews} />
              </Field>
            </div>
            <Field
              label="Interview mode"
              htmlFor="interviewMode"
              hint={
                phoneAvailable
                  ? "Phone call: an outbound AI call, placed within your configured calling hours. In-browser: the candidate talks to the agent in their own browser tab, right away."
                  : "In-browser is the only option until your workspace has an OmniDimension phone number — add one in Settings → Voice interviews."
              }
            >
              <Select id="interviewMode" name="interviewMode" defaultValue={p.interviewMode} disabled={!phoneAvailable}>
                <option value="in_browser">In-browser (candidate&apos;s own mic, right away)</option>
                {phoneAvailable && <option value="phone_call">Phone call (AI calls the candidate, within calling hours)</option>}
              </Select>
            </Field>
            <Field label="CV weight in final score (%)" htmlFor="cvWeight" hint="The interview gets the remainder. Raise the interview share for roles where demonstrated communication matters more than paper credentials.">
              <Input id="cvWeight" name="cvWeight" type="number" min={0} max={100} defaultValue={Math.round(c.cvWeight * 100)} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Knockout: minimum years" htmlFor="minYears" hint="CVs stating fewer years are filtered (and can still be promoted).">
                <Input id="minYears" name="minYears" type="number" min={0} step="0.5" defaultValue={c.minYears ?? ""} />
              </Field>
              <Field label="Knockout: mandatory keywords" htmlFor="mandatoryKeywords" hint="E.g. a required certification. One per line.">
                <Textarea id="mandatoryKeywords" name="mandatoryKeywords" rows={3} defaultValue={c.mandatoryKeywords.join("\n")} />
              </Field>
            </div>
            <Field label="Your screening questions" htmlFor="customQuestions" hint="Up to 5, one per line. Asked verbatim in every interview.">
              <Textarea id="customQuestions" name="customQuestions" rows={4} defaultValue={c.customQuestions.join("\n")} />
            </Field>
            <Field
              label="Human-round scheduling link (optional)"
              htmlFor="schedulingLink"
              hint="A Calendly (or similar) booking page. Included in the automatic email sent when a candidate is shortlisted. Leave blank to just say your team will be in touch."
            >
              <Input id="schedulingLink" name="schedulingLink" type="url" placeholder="https://calendly.com/your-team/interview" defaultValue={p.schedulingLink ?? ""} />
            </Field>
            {editable && (
              <div className="flex justify-end border-t border-line pt-5">
                <SubmitButton>Save settings</SubmitButton>
              </div>
            )}
          </fieldset>
        </ActionForm>
      </Card>
      {isAdmin && (
        <Card className="h-fit">
          <CardHeader title="Role status" />
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap gap-2">
              {(["screening", "completed", "archived"] as const)
                .filter((s) => s !== p.status)
                .map((s) => (
                  <form key={s} action={setPositionStatus}>
                    <input type="hidden" name="positionId" value={p.id} />
                    <input type="hidden" name="status" value={s} />
                    <SubmitButton variant="secondary" size="sm">
                      Mark {s}
                    </SubmitButton>
                  </form>
                ))}
            </div>
            <form action={deletePosition} className="border-t border-line pt-4">
              <input type="hidden" name="positionId" value={p.id} />
              <SubmitButton variant="danger" size="sm" confirm="Permanently delete this role with all CVs, transcripts and reports? This cannot be undone.">
                Delete role and all data
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
}
