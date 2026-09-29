import type { Tone } from "@/components/ui";

export const STAGE: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Processing", tone: "neutral" },
  parsed: { label: "Parsed", tone: "neutral" },
  filtered_out: { label: "Filtered out", tone: "neutral" },
  scored: { label: "Ranked", tone: "info" },
  selected: { label: "Selected", tone: "info" },
  invited: { label: "Invited", tone: "info" },
  consented: { label: "Scheduled", tone: "info" },
  declined: { label: "Wants human", tone: "warn" },
  interviewed: { label: "Interviewed", tone: "info" },
  unreachable: { label: "Unreachable", tone: "warn" },
  shortlisted: { label: "Shortlisted", tone: "good" },
  reserve: { label: "Reserve", tone: "neutral" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Error", tone: "bad" },
};

export const RECOMMENDATION: Record<string, { label: string; tone: Tone }> = {
  strong_fit: { label: "Strong fit", tone: "good" },
  fit: { label: "Fit", tone: "good" },
  borderline: { label: "Borderline", tone: "warn" },
  not_recommended: { label: "Not recommended", tone: "bad" },
};

export const INTERVIEW: Record<string, string> = {
  queued: "Queued",
  dispatched: "Calling",
  completed: "Completed",
  no_answer: "No answer",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const fmtDate = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) : "—";
