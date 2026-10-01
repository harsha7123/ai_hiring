"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { startInterview, requestHuman } from "../actions";
import { InterviewWidget } from "./interview-widget";

export function ConsentForm({ token, consentText }: { token: string; consentText: string }) {
  const [state, action] = useActionState(startInterview, undefined);
  const [humanState, humanAction] = useActionState(requestHuman, undefined);

  if (state?.wsUrl) return <InterviewWidget token={token} wsUrl={state.wsUrl} />;

  return (
    <Card className="mt-8 p-6">
      <form action={action} className="space-y-5">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="consentText" value={consentText} />
        <label className="flex items-start gap-3 rounded-lg bg-sunken p-3 text-sm text-ink-2">
          <input type="checkbox" name="consent" value="yes" required className="mt-0.5 accent-[#141413]" />
          <span>{consentText}</span>
        </label>
        {state?.error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{state.error}</p>}
        <SubmitButton className="h-11 w-full" pendingText="Connecting…">
          Start my interview now
        </SubmitButton>
        <p className="text-center text-xs text-ink-3">You&apos;ll need a quiet spot and about 10 minutes. Your browser will ask for microphone access.</p>
      </form>
      <form action={humanAction} className="mt-4 border-t border-line pt-4 text-center">
        <input type="hidden" name="token" value={token} />
        <button className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">I&apos;d prefer to speak with a person instead</button>
      </form>
      {humanState?.error && <p className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{humanState.error}</p>}
    </Card>
  );
}
