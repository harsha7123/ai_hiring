import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Notice } from "@/components/ui";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-ink-2">Enter your work email and we&apos;ll send you a link to choose a new password.</p>
      {sp.error && (
        <div className="mt-6">
          <Notice tone="warn">That reset link has expired or was already used. Request a new one below.</Notice>
        </div>
      )}
      <ActionForm action={requestPasswordReset} className="mt-8 space-y-4">
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-3">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
