import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, CardHeader, Field, Input, Notice, Textarea } from "@/components/ui";
import { saveSpec } from "../../actions";
import type { PositionRow } from "./data";

export function Requirements({ position: p, editable }: { position: PositionRow; editable: boolean }) {
  if (!p.spec) {
    return <Notice tone={p.specError ? "bad" : "info"}>{p.specError ? `Extraction failed: ${p.specError}` : "Extracting requirements from the job description…"}</Notice>;
  }
  const s = p.spec;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader
          title="Requirement spec"
          description="Extracted from the JD. Edit anything that does not reflect how you genuinely evaluate for this role."
          action={p.specConfirmed ? <Badge tone="good">Confirmed</Badge> : <Badge tone="warn">Needs confirmation</Badge>}
        />
        <ActionForm action={saveSpec} className="space-y-5 p-5">
          <fieldset disabled={!editable} className="space-y-5">
            <input type="hidden" name="positionId" value={p.id} />
            <Field label="Role summary" htmlFor="summary">
              <Textarea id="summary" name="summary" rows={3} defaultValue={s.summary} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Must-have skills" htmlFor="mustHave" hint="One per line. Drives ranking and interview probes.">
                <Textarea id="mustHave" name="mustHave" rows={8} defaultValue={s.mustHave.join("\n")} />
              </Field>
              <Field label="Nice-to-have skills" htmlFor="niceToHave" hint="One per line.">
                <Textarea id="niceToHave" name="niceToHave" rows={8} defaultValue={s.niceToHave.join("\n")} />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-4">
              <Field label="Min years" htmlFor="minYears">
                <Input id="minYears" name="minYears" type="number" min={0} step="0.5" defaultValue={s.minYears ?? ""} />
              </Field>
              <Field label="Max years" htmlFor="maxYears">
                <Input id="maxYears" name="maxYears" type="number" min={0} step="0.5" defaultValue={s.maxYears ?? ""} />
              </Field>
              <Field label="Location" htmlFor="location">
                <Input id="location" name="location" defaultValue={s.location ?? ""} />
              </Field>
              <Field label="Shift" htmlFor="shift">
                <Input id="shift" name="shift" defaultValue={s.shift ?? ""} />
              </Field>
            </div>
            <Field label="Qualifications" htmlFor="qualifications" hint="One per line.">
              <Textarea id="qualifications" name="qualifications" rows={3} defaultValue={s.qualifications.join("\n")} />
            </Field>
            {editable && (
              <div className="flex justify-end gap-2 border-t border-line pt-5">
                <SubmitButton variant="secondary">Save</SubmitButton>
                <SubmitButton name="confirm" value="1" pendingText="Confirming…">
                  {p.specConfirmed ? "Save and re-score" : "Confirm requirements"}
                </SubmitButton>
              </div>
            )}
          </fieldset>
        </ActionForm>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Job description" description="Source text" />
        <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap p-5 font-sans text-sm leading-relaxed text-ink-2">{p.jdText}</pre>
      </Card>
    </div>
  );
}
