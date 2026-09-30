import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, Field, Input } from "@/components/ui";
import { logout, createWorkspace } from "../(auth)/actions";
import { readSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "No workspace yet" };

export default async function NoWorkspacePage() {
  if (await readSession()) redirect("/app");
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Logo />
        <form action={logout}>
          <button className="text-sm text-ink-2 hover:text-ink">Sign out</button>
        </form>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-20 pt-10 sm:pt-20">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;re signed in, but not part of a workspace yet</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            Signed in as {user.email}. If you were expecting an invite, ask whoever invited you to check the email address they used. Or create your own
            workspace:
          </p>
          <Card className="mt-8 p-6">
            <ActionForm action={createWorkspace}>
              <Field label="Organisation name" htmlFor="orgName">
                <Input id="orgName" name="orgName" autoComplete="organization" required />
              </Field>
              <SubmitButton className="mt-4 w-full">Create workspace</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </main>
    </div>
  );
}
