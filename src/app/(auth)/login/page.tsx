import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Notice } from "@/components/ui";
import { readSession } from "@/lib/auth/session";
import { LegalLinks } from "@/components/legal-links";
import { login } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  // Only an invite page is a valid return target (the login action re-checks this).
  const next = typeof sp.next === "string" && /^\/invite\/[A-Za-z0-9_-]{20,64}$/.test(sp.next) ? sp.next : null;
  if (await readSession()) redirect(next ?? "/app");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-2">Welcome back to your screening workspace.</p>
      {(sp.error === "link_expired" || sp.error === "invalid_link") && (
        <div className="mt-6">
          <Notice tone="warn">That email link has expired or was already used. Sign in, or request a new link.</Notice>
        </div>
      )}
      <ActionForm action={login} className="mt-8 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <p className="-mt-1 text-right text-sm">
          <Link href="/forgot-password" className="text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Forgot password?
          </Link>
        </p>
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
      <LegalLinks />
    </>
  );
}
