"use client";

import { useActionState, useState } from "react";
import { Card, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { respondToInvite } from "../actions";

export function ConsentForm({ token, consentText }: { token: string; consentText: string }) {
  const [state, action] = useActionState(respondToInvite, undefined);
  const [choice, setChoice] = useState<"now" | "schedule">("schedule");

  return (
    <Card className="mt-8 p-6">
      <form action={action} className="space-y-5">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="consentText" value={consentText} />
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">When should we call?</legend>
          {(
            [
              ["schedule", "Pick a time", "Choose a slot in the next two weeks"],
              ["now", "Call me now", "You'll get a call within a few minutes"],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={cx("flex cursor-pointer items-start gap-3 rounded-lg border p-3", choice === value ? "border-ink" : "border-line-2")}
            >
              <input type="radio" name="choice" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1 accent-[#141413]" />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-ink-3">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {choice === "schedule" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Date and time (IST, 9:00–20:00)</span>
            <input type="datetime-local" name="when" required className="h-11 w-full rounded-lg border border-line-2 bg-surface px-3 text-sm" />
          </label>
        )}
        <label className="flex items-start gap-3 rounded-lg bg-sunken p-3 text-sm text-ink-2">
          <input type="checkbox" name="consent" value="yes" required className="mt-0.5 accent-[#141413]" />
          <span>{consentText}</span>
        </label>
        {state?.error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{state.error}</p>}
        <SubmitButton className="h-11 w-full" pendingText="Saving…">
          {choice === "now" ? "Consent and call me now" : "Consent and book this time"}
        </SubmitButton>
      </form>
      <form action={action} className="mt-4 border-t border-line pt-4 text-center">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="choice" value="human" />
        <button className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">I&apos;d prefer to speak with a person instead</button>
      </form>
    </Card>
  );
}
