import type { Metadata } from "next";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { can, requirePage } from "@/lib/auth/guard";
import { messagingConfigured } from "@/lib/messaging";
import { ActionForm, CopyButton, SubmitButton } from "@/components/client";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, td, th } from "@/components/ui";
import { fmtDate } from "@/lib/labels";
import {
  clearVoiceKey,
  inviteMember,
  provisionAgent,
  removeMember,
  revokeInvite,
  rotateWebhookSecret,
  saveVoice,
  updateOrg,
} from "../actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requirePage("admin");
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, ctx.org.id));
  const members = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, lastLoginAt: schema.users.lastLoginAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, ctx.org.id));
  const invites = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.orgId, ctx.org.id), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .orderBy(desc(schema.invites.createdAt));

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const webhookUrl = `${appUrl}/api/webhooks/omnidim/${org.webhookSecret}`;
  const keySource = org.omnidimApiKeyEnc ? "workspace" : process.env.OMNIDIM_API_KEY ? "platform" : null;
  const voiceReady = !!keySource && !!org.omnidimAgentId;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" description={`Workspace settings for ${org.name}.`} />

      <Card>
        <CardHeader
          title="Voice interviews · OmniDimension"
          description="Outbound AI interviews are placed through your OmniDimension account."
          action={voiceReady ? <Badge tone="good">Connected</Badge> : <Badge tone="warn">Not configured</Badge>}
        />
        <div className="space-y-6 p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>Paste your OmniDimension API key (Dashboard → API). {keySource === "platform" && "A platform-wide key is already set on the server; a workspace key overrides it."}</li>
            <li>Click <span className="font-medium text-ink">Create interview agent</span>. The agent is configured with AI disclosure, adaptive follow-ups and this webhook.</li>
            <li>Optionally set the phone number ID to call from (Dashboard → Phone numbers). Otherwise your default number is used.</li>
          </ol>
          <ActionForm action={saveVoice} className="space-y-4">
            <Field label="API key" htmlFor="apiKey" hint={org.omnidimApiKeyEnc ? "A key is saved (encrypted with AES-256-GCM). Leave blank to keep it." : "Stored encrypted. Never shown again after saving."}>
              <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={org.omnidimApiKeyEnc ? "••••••••••••  saved" : "Paste key"} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent ID" htmlFor="agentId" hint="Filled automatically when you create the agent; or use an agent you built yourself.">
                <Input id="agentId" name="agentId" type="number" defaultValue={org.omnidimAgentId ?? ""} />
              </Field>
              <Field label="From number ID (optional)" htmlFor="fromNumberId">
                <Input id="fromNumberId" name="fromNumberId" type="number" defaultValue={org.omnidimFromNumberId ?? ""} />
              </Field>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <SubmitButton pendingText="Verifying…">Save voice settings</SubmitButton>
            </div>
          </ActionForm>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <ActionForm action={provisionAgent}>
              <SubmitButton variant="secondary" pendingText="Creating agent…">
                {org.omnidimAgentId ? "Create a new interview agent" : "Create interview agent"}
              </SubmitButton>
            </ActionForm>
            {org.omnidimApiKeyEnc && (
              <form action={clearVoiceKey}>
                <SubmitButton variant="ghost" size="sm" confirm="Remove the saved OmniDimension key?">
                  Remove saved key
                </SubmitButton>
              </form>
            )}
          </div>
          <div className="rounded-lg bg-sunken p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-ink-3">Post-call webhook URL</div>
                <code className="mt-1 block truncate font-mono text-xs text-ink-2">{webhookUrl}</code>
              </div>
              <div className="flex shrink-0 gap-2">
                <CopyButton value={webhookUrl} />
                {can(ctx.role, "owner") && (
                  <form action={rotateWebhookSecret}>
                    <SubmitButton variant="ghost" size="sm" confirm="Rotate the webhook secret? Existing agents must be updated with the new URL.">
                      Rotate
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Keep this URL private: the secret in it authenticates OmniDimension. Call results are also reconciled from call logs every 20 seconds, so interviews complete even if a webhook is missed.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Candidate messaging"
          description="Consent invitations by SMS or WhatsApp."
          action={messagingConfigured() ? <Badge tone="good">{process.env.TWILIO_CHANNEL === "whatsapp" ? "WhatsApp" : "SMS"} via Twilio</Badge> : <Badge>Manual links</Badge>}
        />
        <p className="p-5 text-sm text-ink-2">
          {messagingConfigured()
            ? "Invitations are sent automatically when candidates are selected, and re-sent up to three times."
            : "Automatic sending is not configured on this server (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM). Until then, copy each candidate's invite link from the role's Interview pipeline."}
        </p>
      </Card>

      <Card>
        <CardHeader title="Team" description="Owners and admins manage settings. Recruiters run roles. Viewers can read reports." />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Member</th>
                <th className={th}>Role</th>
                <th className={th}>Last sign-in</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-ink-3">{m.email}</div>
                  </td>
                  <td className={td}>
                    <Badge tone={m.role === "owner" ? "ink" : "neutral"}>{m.role}</Badge>
                  </td>
                  <td className={`${td} text-ink-3`}>{fmtDate(m.lastLoginAt)}</td>
                  <td className={`${td} text-right`}>
                    {m.id !== ctx.user.id && m.role !== "owner" && (m.role !== "admin" || ctx.role === "owner") && (
                      <form action={removeMember}>
                        <input type="hidden" name="userId" value={m.id} />
                        <SubmitButton variant="ghost" size="sm" confirm={`Remove ${m.name}? Their access ends immediately.`}>
                          Remove
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {invites.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <div className="text-ink-2">{i.email}</div>
                    <div className="text-xs text-ink-3">Invite expires {fmtDate(i.expiresAt)}</div>
                  </td>
                  <td className={td}>
                    <Badge>{i.role} · pending</Badge>
                  </td>
                  <td className={td} />
                  <td className={`${td} text-right`}>
                    <form action={revokeInvite}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Revoke
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ActionForm action={inviteMember} resetOnSuccess className="border-t border-line p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
            <Field label="Invite by email" htmlFor="inviteEmail">
              <Input id="inviteEmail" name="email" type="email" required placeholder="colleague@company.com" />
            </Field>
            <Field label="Role" htmlFor="inviteRole">
              <Select id="inviteRole" name="role" defaultValue="recruiter">
                <option value="recruiter">Recruiter</option>
                <option value="viewer">Viewer</option>
                {ctx.role === "owner" && <option value="admin">Admin</option>}
              </Select>
            </Field>
            <SubmitButton>Create invite</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Workspace and data retention" description="Data older than these windows is purged automatically." />
        <ActionForm action={updateOrg} className="space-y-4 p-5">
          <Field label="Organisation name" htmlFor="name" hint="Shown to candidates in invitations and on the call.">
            <Input id="name" name="name" defaultValue={org.name} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recordings (days)" htmlFor="retentionRecordingDays">
              <Input id="retentionRecordingDays" name="retentionRecordingDays" type="number" min={7} defaultValue={org.settings.retentionRecordingDays} />
            </Field>
            <Field label="Candidate records (days)" htmlFor="retentionRecordDays">
              <Input id="retentionRecordDays" name="retentionRecordDays" type="number" min={30} defaultValue={org.settings.retentionRecordDays} />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
