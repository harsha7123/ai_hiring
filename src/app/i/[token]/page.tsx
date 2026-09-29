import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card } from "@/components/ui";
import { fmtDate } from "@/lib/labels";
import { ConsentForm } from "./form";

export const metadata: Metadata = { title: "Interview invitation", robots: { index: false, follow: false } };

/** Scheduled more than a few minutes out (vs. "call me now"). */
const isLater = (d: Date | null) => !!d && d.getTime() > Date.now() + 5 * 60_000;

export default async function InvitePage({ params }: PageProps<"/i/[token]">) {
  const { token } = await params;
  const [row] = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await db
        .select({ c: schema.candidates, orgName: schema.organizations.name, title: schema.positions.title, nextAttemptAt: schema.interviews.nextAttemptAt })
        .from(schema.candidates)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.candidates.orgId))
        .innerJoin(schema.positions, eq(schema.positions.id, schema.candidates.positionId))
        .leftJoin(schema.interviews, eq(schema.interviews.candidateId, schema.candidates.id))
        .where(eq(schema.candidates.inviteToken, token))
    : [];

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen px-5 py-12 sm:py-20">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  );

  if (!row) {
    return shell(
      <Card className="p-8 text-center">
        <p className="font-medium">This link is not valid</p>
        <p className="mt-1 text-sm text-ink-3">It may have expired. Please contact the recruiter who invited you.</p>
      </Card>,
    );
  }
  const { c, orgName, title } = row;
  const first = c.name?.split(" ")[0];
  const consentText = `I agree that ${orgName} may conduct a recorded screening interview with me using an AI voice assistant, and process my CV, the recording and the transcript to assess my application for ${title}. I understand the AI assists the hiring team; people make the hiring decision. I can ask for a human interviewer instead, and I can request deletion of my data.`;

  return shell(
    <>
      <p className="text-sm text-ink-3">{orgName}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {first ? `${first}, you're invited` : "You're invited"} to interview for {title}
      </h1>

      {c.stage === "consented" ? (
        <Card className="mt-8 p-6">
          <p className="font-medium">You&apos;re all set.</p>
          <p className="mt-1 text-sm text-ink-2">
            Expect a call {isLater(row.nextAttemptAt) ? `around ${fmtDate(row.nextAttemptAt)} (IST)` : "within the next few minutes"} from our AI interview assistant. Please keep
            about 10 minutes free somewhere quiet.
          </p>
        </Card>
      ) : c.stage === "declined" ? (
        <Card className="mt-8 p-6">
          <p className="font-medium">Thanks for letting us know.</p>
          <p className="mt-1 text-sm text-ink-2">The recruiting team at {orgName} will contact you directly to arrange a conversation with a person.</p>
        </Card>
      ) : ["selected", "invited"].includes(c.stage) ? (
        <>
          <div className="mt-6 space-y-3 text-[15px] leading-relaxed text-ink-2">
            <p>
              The first round is a short, structured phone interview of about 8 to 12 minutes, conducted by an <strong className="font-medium text-ink">AI voice assistant</strong> acting for {orgName}. The call is recorded
              so the hiring team can review it.
            </p>
            <p>You can ask questions about the role during the call. People at {orgName} review every interview and make all decisions.</p>
          </div>
          <ConsentForm token={token} consentText={consentText} />
        </>
      ) : (
        <Card className="mt-8 p-6">
          <p className="font-medium">This invitation is no longer active.</p>
          <p className="mt-1 text-sm text-ink-3">Thank you for your time. The recruiting team will be in touch.</p>
        </Card>
      )}
      <p className="mt-10 text-xs text-ink-3">Your data is processed only for this application and deleted on request or after the retention period.</p>
    </>,
  );
}
