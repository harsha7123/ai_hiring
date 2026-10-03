"use server";

import { revalidatePath } from "next/cache";
import { clientIp } from "@/lib/auth/session";
import { recordConsent, recordHumanRequest, startWebInterview } from "@/lib/pipeline";
import type { FormState } from "@/components/client";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * Candidate consents. For an in-browser role the browser then connects
 * directly — wsUrl is returned. For a phone-call role there's nothing more
 * for the browser to do: the call itself is placed later by the scheduler,
 * within calling hours — waitingForCall tells the page to show that instead.
 */
export type StartState = { error?: string; wsUrl?: string; waitingForCall?: boolean };

export async function startInterview(_: StartState | undefined, fd: FormData): Promise<StartState> {
  const token = String(fd.get("token") ?? "");
  const consentText = String(fd.get("consentText") ?? "").slice(0, 2000);
  if (!TOKEN_RE.test(token)) return { error: "Invalid invitation link." };
  if (fd.get("consent") !== "yes") return { error: "Please confirm your consent to continue." };
  try {
    const { mode } = await recordConsent({ token, ip: await clientIp(), consentText });
    if (mode === "phone_call") return { waitingForCall: true };
    const { wsUrl } = await startWebInterview(token);
    return { wsUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start the interview." };
  }
}

export async function requestHuman(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  if (!TOKEN_RE.test(token)) return { error: "Invalid invitation link." };
  try {
    await recordHumanRequest(token, await clientIp());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save your response." };
  }
  revalidatePath(`/i/${token}`);
  return { ok: "saved" };
}
