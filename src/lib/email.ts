/**
 * Transactional email via Resend's REST API (https://resend.com). Chosen over
 * SMTP for the same reason as the Twilio REST calls elsewhere in this app: a
 * plain fetch, no extra SDK, easy to mock in tests.
 */
export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const BASE = (process.env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/$/, "");

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Wraps plain text in a minimal, neutral HTML email that mirrors the app's own design. */
function toHtml(body: string) {
  const paragraphs = body
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px;color:#141413;font-size:15px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="background:#f7f7f5;margin:0;padding:32px 16px;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e6e2;border-radius:14px;padding:32px;">${paragraphs}</div>
  </body></html>`;
}

export async function sendEmail(to: string, subject: string, body: string): Promise<{ sent: boolean; error?: string }> {
  if (!emailConfigured()) return { sent: false, error: "Email not configured" };
  try {
    const res = await fetch(`${BASE}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html: toHtml(body), text: body }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { sent: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (e: string | null | undefined): e is string => !!e && EMAIL_RE.test(e.trim());
