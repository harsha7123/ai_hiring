import type { Metadata } from "next";
import Link from "next/link";
import { operator } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms" };

/** Baseline terms of use for workspace users. To be reviewed by the operator's counsel before launch. */
export default function TermsPage() {
  const op = operator();
  return (
    <>
      <h1>Terms of use</h1>
      <p className="text-sm text-ink-3">Last updated {op.updated}</p>
      <p>These terms apply to organisations and people who use Shortlist, operated by {op.name}, to screen job applications.</p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Upload only CVs you are entitled to process for recruitment, and tell candidates how their data is used (the candidate pages and the <Link href="/privacy" className="text-ink underline underline-offset-2">privacy notice</Link> help with this).</li>
        <li>Keep sign-in details confidential and give team members only the role they need.</li>
        <li>Make hiring decisions yourselves. Scores and reports are decision support, not decisions; do not reject anyone solely because of an automated score.</li>
        <li>Respond to candidates’ requests to access, correct or erase their data; admins can erase a candidate’s data from the candidate’s page.</li>
        <li>Do not use the service for unlawful discrimination, or to process data unrelated to recruitment.</li>
      </ul>

      <h2>The service</h2>
      <ul>
        <li>AI output can be wrong. Reports quote their sources so you can check them; verify anything important before relying on it.</li>
        <li>Interview and AI usage may be limited by the spend caps your workspace sets.</li>
        <li>We may suspend access to protect the service or other users, and will tell you why where we can.</li>
      </ul>

      <h2>Data</h2>
      <p>
        You keep ownership of the data you upload. We process it only to provide the service, as described in the privacy notice, and delete it according to your
        workspace’s retention settings or when you ask.
      </p>

      <h2>Contact</h2>
      <p>{op.email ? <>Questions about these terms: <a href={`mailto:${op.email}`} className="text-ink underline underline-offset-2">{op.email}</a>.</> : "Contact your account administrator with questions about these terms."}</p>
    </>
  );
}
