import type { Metadata } from "next";
import { operator } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy notice" };

/**
 * Plain-language privacy notice written around India's Digital Personal Data
 * Protection Act, 2023. It describes what this software actually does; the
 * deployment's operator should have it reviewed by their own counsel.
 */
export default function PrivacyPage() {
  const op = operator();
  const contact = op.email ? <a href={`mailto:${op.email}`} className="text-ink underline underline-offset-2">{op.email}</a> : "the contact details the hiring organisation gave you";
  return (
    <>
      <h1>Privacy notice</h1>
      <p className="text-sm text-ink-3">Last updated {op.updated}</p>
      <p>
        This service (“Shortlist”) helps hiring teams screen job applications. It is operated by {op.name}. Each hiring organisation using it decides which
        roles to screen and which candidates to consider; for candidates’ data, that organisation is the data fiduciary and we process the data on its behalf.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>From candidates: the CV the hiring organisation uploads (name, contact details, work history, education, skills), your consent record (time and IP address), and, if you take the AI interview, its audio recording and transcript.</li>
        <li>From recruiters: name, work email, organisation and sign-in activity.</li>
        <li>Technical data needed to run and secure the service, such as IP addresses and an audit log of actions taken.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To match CVs to a role’s requirements, run the screening interview you consented to, and prepare an evidence-based report for the hiring team.</li>
        <li>To send interview invitations and status updates by email or SMS.</li>
        <li>To keep the service secure and to meet legal obligations.</li>
      </ul>
      <p>
        <strong className="text-ink">AI assists; people decide.</strong> Automated scoring ranks and summarises applications, but it never rejects anyone. Before
        scoring, names, contact details, age, gender, marital status, religion, caste and nationality are removed from the text, and every statement in a report
        must quote the CV or interview it came from. You can ask for a human interviewer instead of the AI interview at any time.
      </p>

      <h2>Who processes it for us</h2>
      <ul>
        <li>Supabase (sign-in, database and file storage)</li>
        <li>OpenAI (CV and interview analysis)</li>
        <li>OmniDimension (AI voice interviews and recordings)</li>
        <li>Resend (email) and Twilio (SMS / WhatsApp), where the hiring organisation uses them</li>
        <li>Our hosting provider</li>
      </ul>
      <p>These providers may process data outside India. They act only on our instructions and under contractual data-protection terms.</p>

      <h2>How long we keep it</h2>
      <p>
        Interview recordings are kept for 90 days by default and candidate records for 180 days after the last activity, unless the hiring organisation sets
        shorter periods. After that they are deleted automatically.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>Access a summary of your data and how it is used</li>
        <li>Correct or update it</li>
        <li>Have it erased (we delete your CV, transcripts, recording links and scores, including copies held for other roles)</li>
        <li>Withdraw consent for the AI interview</li>
        <li>Nominate someone to exercise these rights for you</li>
        <li>Raise a grievance, and, if unresolved, complain to the Data Protection Board of India</li>
      </ul>
      <p>
        To use any of these rights, contact {contact}
        {op.grievanceOfficer ? `, or our grievance officer, ${op.grievanceOfficer}` : ""}. We respond within the time limits the law sets.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, files are stored privately and only ever served to signed-in members of the hiring organisation, access is limited by role,
        and sensitive actions are recorded in an audit log.
      </p>
    </>
  );
}
