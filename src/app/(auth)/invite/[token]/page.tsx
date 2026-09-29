import type { Metadata } from "next";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Notice } from "@/components/ui";
import { acceptInvite } from "../../actions";

export const metadata: Metadata = { title: "Join workspace" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [row] = await db
    .select({ invite: schema.invites, orgName: schema.organizations.name })
    .from(schema.invites)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invites.orgId))
    .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  if (!row) return <Notice tone="bad">This invitation is invalid, already used, or has expired.</Notice>;
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, row.invite.email));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {row.orgName}</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        You were invited as <span className="font-medium text-ink">{row.invite.role}</span> ({row.invite.email}).
      </p>
      <ActionForm action={acceptInvite} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />
        {!existing && (
          <Field label="Your name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
        )}
        <Field
          label={existing ? "Your existing password" : "Choose a password"}
          htmlFor="password"
          hint={existing ? "You already have an account; confirm it to join." : "At least 10 characters, with letters and a number."}
        >
          <Input id="password" name="password" type="password" autoComplete={existing ? "current-password" : "new-password"} required />
        </Field>
        <SubmitButton className="w-full">Join workspace</SubmitButton>
      </ActionForm>
    </>
  );
}
