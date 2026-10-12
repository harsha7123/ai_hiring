import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Notice } from "@/components/ui";
import { verifiedUser } from "@/lib/auth/session";
import { updatePassword } from "../actions";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the reset email via /auth/callback, which signs the user in first. */
export default async function ResetPasswordPage() {
  const user = await verifiedUser();
  if (!user) {
    return (
      <Notice tone="bad">
        This reset link has expired or was already used.{" "}
        <Link href="/forgot-password" className="font-medium underline underline-offset-4">
          Request a new one
        </Link>
        .
      </Notice>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-ink-2">For {user.email}.</p>
      <ActionForm action={updatePassword} className="mt-8 space-y-4">
        <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and a number.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Field label="Repeat new password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <SubmitButton className="w-full" pendingText="Saving…">
          Save password
        </SubmitButton>
      </ActionForm>
    </>
  );
}
