/**
 * The only in-app paths a post-login / email-link redirect may go to. Anything
 * else (absolute URLs, protocol-relative "//evil.com", other paths) falls back
 * to /app, so redirect parameters can't be used for phishing.
 */
export function safeNextPath(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  if (s === "/app" || s === "/reset-password") return s;
  if (/^\/invite\/[A-Za-z0-9_-]{20,64}$/.test(s)) return s;
  return "/app";
}
