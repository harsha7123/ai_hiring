"use server";

import { revalidatePath } from "next/cache";
import { clientIp } from "@/lib/auth/session";
import { recordConsent, recordHumanRequest, startWebInterview } from "@/lib/pipeline";
import type { FormState } from "@/components/client";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** Candidate consents, then the browser connects directly — returns the session's wsUrl. */
export type StartState = { error?: string; wsUrl?: string };

export async function startInterview(_: StartState | undefined, fd: FormData): Promise<StartState> {
  const token = String(fd.get("token") ?? "");
  const consentText = String(fd.get("consentText") ?? "").slice(0, 2000);
  if (!TOKEN_RE.test(token)) return { error: "Invalid invitation link." };
  if (fd.get("consent") !== "yes") return { error: "Please confirm your consent to continue." };
  try {
    await recordConsent({ token, ip: await clientIp(), consentText });
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
