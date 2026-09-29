"use server";

import { revalidatePath } from "next/cache";
import { clientIp } from "@/lib/auth/session";
import { recordConsent } from "@/lib/pipeline";
import type { FormState } from "@/components/client";

const TZ_OFFSET_MIN = Number(process.env.APP_TZ_OFFSET_MINUTES ?? 330);

export async function respondToInvite(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const choice = String(fd.get("choice") ?? "");
  const consentText = String(fd.get("consentText") ?? "").slice(0, 2000);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "Invalid invitation link." };
  if (!["now", "schedule", "human"].includes(choice)) return { error: "Choose an option." };
  if (choice !== "human" && fd.get("consent") !== "yes") return { error: "Please confirm your consent to continue." };

  let scheduledAt: Date | undefined;
  if (choice === "schedule") {
    // <input type="datetime-local"> has no zone; it is in the company's local time.
    const m = String(fd.get("when") ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return { error: "Pick a date and time." };
    const [, y, mo, d, h, mi] = m.map(Number);
    scheduledAt = new Date(Date.UTC(y, mo - 1, d, h, mi) - TZ_OFFSET_MIN * 60_000);
    if (h < 9 || h >= 20) return { error: "Please choose a time between 9:00 and 20:00." };
    if (scheduledAt.getTime() < Date.now() - 5 * 60_000 || scheduledAt.getTime() > Date.now() + 14 * 864e5) {
      return { error: "Please choose a time within the next two weeks." };
    }
  }
  try {
    await recordConsent({ token, choice: choice as "now" | "schedule" | "human", scheduledAt, ip: await clientIp(), consentText });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save your response." };
  }
  revalidatePath(`/i/${token}`);
  return { ok: "saved" };
}
