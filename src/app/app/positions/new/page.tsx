import Link from "next/link";
import type { Metadata } from "next";
import { requirePage } from "@/lib/auth/guard";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { createPosition } from "../../actions";

export const metadata: Metadata = { title: "New role" };

export default async function NewPosition() {
  await requirePage("recruiter");
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow={<Link href="/app" className="hover:text-ink">Roles</Link>}
        title="New role"
        description="Paste the job description. It is turned into a structured requirement spec that you confirm before any CV is scored."
      />
      <Card className="p-6">
        <ActionForm action={createPosition} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Role title" htmlFor="title">
              <Input id="title" name="title" placeholder="Senior Site Reliability Engineer" required />
            </Field>
            <Field label="Location" htmlFor="location">
              <Input id="location" name="location" placeholder="Bengaluru · Hybrid" />
            </Field>
          </div>
          <Field label="Job description" htmlFor="jdText">
            <Textarea id="jdText" name="jdText" rows={14} required minLength={200} placeholder="Paste the full JD, including requirements and nice-to-haves." />
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Shortlist size" htmlFor="targetShortlist" hint="Finalists for the panel">
              <Input id="targetShortlist" name="targetShortlist" type="number" min={1} max={500} defaultValue={20} />
            </Field>
            <Field label="Interview pool" htmlFor="interviewPool" hint="Top CVs invited to interview">
              <Input id="interviewPool" name="interviewPool" type="number" min={1} max={2000} defaultValue={200} />
            </Field>
            <Field label="Call spend cap" htmlFor="maxInterviews" hint="Max dials, incl. retries">
              <Input id="maxInterviews" name="maxInterviews" type="number" min={1} max={5000} defaultValue={250} />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingText="Creating…">Create role</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
