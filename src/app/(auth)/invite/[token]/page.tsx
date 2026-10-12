import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { verifiedUser } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Notice } from "@/components/ui";
import { acceptInvite, joinInvite, logout } from "../../actions";

export const metadata: Metadata = { title: "Join workspace" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [row] = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await db
        .select({ invite: schema.invites, orgName: schema.organizations.name })
        .from(schema.invites)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invites.orgId))
        .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    : [];
  if (!row) return <Notice tone="bad">This invitation is invalid, already used, or has expired.</Notice>;
  const invitedEmail = row.invite.email.toLowerCase();
  const [user, [existing]] = await Promise.all([
    verifiedUser(),
    db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, invitedEmail)),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {row.orgName}</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        You were invited as <span className="font-medium text-ink">{row.invite.role}</span> ({row.invite.email}).
      </p>
      {user && user.email === invitedEmail ? (
        <ActionForm action={acceptInvite} className="mt-8">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="w-full">Join {row.orgName}</SubmitButton>
        </ActionForm>
      ) : user ? (
        <div className="mt-8 space-y-4">
          <Notice tone="warn">
            You&apos;re signed in as {user.email}. Sign out, then sign in as {row.invite.email} to accept this invitation.
          </Notice>
          <form action={logout}>
            <SubmitButton variant="secondary" className="w-full">
              Sign out
            </SubmitButton>
          </form>
        </div>
      ) : existing ? (
        <div className="mt-8">
          <Notice tone="info">
            You already have an account with this email.{" "}
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="font-medium underline underline-offset-4">
              Sign in
            </Link>{" "}
            and you&apos;ll come back here to join {row.orgName}.
          </Notice>
        </div>
      ) : (
        <ActionForm action={joinInvite} className="mt-8 space-y-4">
          <input type="hidden" name="token" value={token} />
          <Field label="Your name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field label="Choose a password" htmlFor="password" hint="At least 10 characters, with letters and a number.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <SubmitButton className="w-full">Create account and join</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
