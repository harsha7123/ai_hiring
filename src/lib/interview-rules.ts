/**
 * Pure interview rules (no database, no network), shared by the pipeline, the
 * candidate's browser widget and the unit tests.
 */
import type { OrgSettings, PositionConfig } from "@/db/schema";

/** IST (UTC+5:30) — this app's calling-hours window (org.settings.callWindow*) is always local India time. */
const TZ_OFFSET_MIN = 330;

export const fmtHour = (h: number) => (h === 0 || h === 24 ? "12am" : h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`);

export function callWindow(settings: Pick<OrgSettings, "callWindowStartHour" | "callWindowEndHour">): { startHour: number; endHour: number } {
  const startHour = Number.isFinite(settings.callWindowStartHour) ? settings.callWindowStartHour : 9;
  const endHour = Number.isFinite(settings.callWindowEndHour) ? settings.callWindowEndHour : 18;
  return { startHour, endHour };
}

/** Next IST moment at or after `from` that falls inside the org's calling-hours window. */
export function nextCallSlot(from: Date, settings: Pick<OrgSettings, "callWindowStartHour" | "callWindowEndHour">): Date {
  const { startHour, endHour } = callWindow(settings);
  const local = new Date(from.getTime() + TZ_OFFSET_MIN * 60_000);
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (h >= startHour && h < endHour) return from;
  const dayOffset = h >= endHour ? 1 : 0;
  const nextLocalStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, startHour, 0));
  return new Date(nextLocalStart.getTime() - TZ_OFFSET_MIN * 60_000);
}

export function combinedScore(cv: number | null, interview: number, config: Pick<PositionConfig, "cvWeight">) {
  const w = Math.min(1, Math.max(0, config.cvWeight));
  return Math.round(((cv ?? 0) * w + interview * (1 - w)) * 10) / 10;
}

/** Shorter than this, a transcript means the interview never really started. */
export const MIN_TRANSCRIPT_CHARS = 80;

/**
 * Sanity check for a transcript the candidate's own browser posted. Two people
 * taking turns speak well under ~20 characters a second combined; 45/s plus
 * slack is far above any real conversation, so anything longer than that for
 * the time the session has actually been open (measured on the server, from
 * when we created it) was not captured live and is rejected.
 */
export function browserTranscriptIsPlausible(transcript: string, serverElapsedSec: number): boolean {
  return transcript.length <= Math.max(0, serverElapsedSec) * 45 + 600;
}

export type TranscriptLine = { role: "user" | "agent"; text: string; final: boolean };

/**
 * Folds one streamed transcript event into the running list of lines. A
 * non-final line is still growing (live ASR/TTS text), so the next event for
 * the same speaker replaces it. Once a line is final it is never overwritten:
 * the next event starts a new line, even from the same speaker (a candidate
 * pausing mid-answer produces several final segments in a row).
 */
export function mergeTranscriptEvent(lines: TranscriptLine[], t: TranscriptLine): TranscriptLine[] {
  const last = lines[lines.length - 1];
  if (last && !last.final && last.role === t.role) return [...lines.slice(0, -1), t];
  return [...lines, t];
}
