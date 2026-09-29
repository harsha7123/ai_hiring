import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Notice } from "@/components/ui";
import { readSession } from "@/lib/auth/session";
import { signup, signupAllowed } from "../actions";

export const metadata: Metadata = { title: "Create workspace" };

export default async function SignupPage() {
  if (await readSession()) redirect("/app");
  if (!(await signupAllowed())) {
    return <Notice>Self-service sign-up is disabled on this deployment. Ask your administrator for an invitation.</Notice>;
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1.5 text-sm text-ink-2">Each organisation gets an isolated workspace for its roles and candidates.</p>
      <ActionForm action={signup} className="mt-8 space-y-4">
        <Field label="Organisation" htmlFor="orgName">
          <Input id="orgName" name="orgName" autoComplete="organization" required />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and a number.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating…">
          Create workspace
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-3">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
