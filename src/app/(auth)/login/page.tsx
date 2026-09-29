import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input } from "@/components/ui";
import { readSession } from "@/lib/auth/session";
import { login } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await readSession()) redirect("/app");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-2">Welcome back to your screening workspace.</p>
      <ActionForm action={login} className="mt-8 space-y-4">
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-3">
        New here?{" "}
        <Link href="/signup" className="font-medium text-ink underline-offset-4 hover:underline">
          Create a workspace
        </Link>
      </p>
    </>
  );
}
