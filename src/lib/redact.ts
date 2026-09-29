/**
 * Bias control: strip identity attributes before any text is scored.
 * Name, contact details, date of birth / age, gender, marital status, religion,
 * caste and nationality lines are removed or masked.
 */
const SENSITIVE_LINE =
  /^\s*(date of birth|dob|d\.o\.b|age|gender|sex|marital status|religion|caste|category|nationality|father'?s name|mother'?s name|spouse)\b.*$/gim;

export function redactForScoring(text: string, name?: string | null): string {
  let out = text
    .replace(SENSITIVE_LINE, "[redacted personal detail]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    // Phone numbers: 10-15 digits. Date ranges like "2018 - 2021" have fewer and are kept.
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 10 && digits <= 15 ? "[phone]" : m;
    })
    .replace(/\b(he|she|him|her|his|hers|mr|mrs|ms|miss)\b\.?/gi, "they")
    .replace(/https?:\/\/\S*linkedin\S*/gi, "[profile link]");
  if (name) {
    for (const part of name.split(/\s+/).filter((p) => p.length > 2)) {
      out = out.replace(new RegExp(`\\b${escapeRe(part)}\\b`, "gi"), "[candidate]");
    }
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Normalise for quote verification: case, whitespace, punctuation-insensitive. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9%+#.' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the quote is actually present in the source. Short quotes must match
 * exactly (after normalisation); long quotes may differ by trimming at the ends.
 */
export function quoteIsGrounded(quote: string, source: string): boolean {
  const q = normalise(quote.replace(/\[(candidate|email|phone|redacted personal detail|profile link)\]/g, " "));
  if (q.length < 8) return false;
  const src = normalise(source);
  if (src.includes(q)) return true;
  // Tolerate an ellipsis joining two exact fragments.
  const parts = q.split(/\.{3,}|…/).map((p) => p.trim()).filter((p) => p.length >= 8);
  return parts.length > 1 && parts.every((p) => src.includes(p));
}
