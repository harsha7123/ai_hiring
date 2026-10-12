/**
 * Structured logging and error alerting, with no third-party SDK.
 *
 * Every line is one JSON object on stdout/stderr, which Railway, Render,
 * DigitalOcean and Docker all collect and let you search by field. Errors are
 * also posted to ERROR_WEBHOOK_URL when set — a Slack or Discord incoming
 * webhook, or any endpoint accepting JSON — so someone hears about failures
 * without watching logs. Alerts are de-duplicated per message so a failing
 * loop can't flood the channel.
 */

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 8).join("\n") };
  return { message: String(err) };
}

function write(level: Level, msg: string, fields?: Fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }, (_, v) => (v instanceof Error ? serializeError(v) : v));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

const ALERT_DEDUPE_MS = 10 * 60_000;
const lastAlert = new Map<string, number>();

/** Logs an error and, if configured, sends an alert (at most once per message every 10 minutes). */
export function reportError(msg: string, err: unknown, fields?: Fields) {
  write("error", msg, { ...fields, err: serializeError(err) });
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const key = `${msg}:${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
  const now = Date.now();
  if ((lastAlert.get(key) ?? 0) > now - ALERT_DEDUPE_MS) return;
  lastAlert.set(key, now);
  if (lastAlert.size > 500) for (const [k, t] of lastAlert) if (t < now - ALERT_DEDUPE_MS) lastAlert.delete(k);
  const text = `[${process.env.APP_URL ?? "shortlist"}] ${msg}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1500);
  // Slack reads `text`, Discord reads `content`; generic receivers get both plus fields.
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text, ...fields }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
