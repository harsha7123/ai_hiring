/**
 * Startup configuration check. Misconfiguration otherwise shows up much later
 * and far from its cause (an invite link pointing at localhost, encrypted data
 * that can't be decrypted, a microphone the browser refuses). In production a
 * missing required variable stops the server from starting; in development it
 * only warns.
 */
import { log } from "./log";

export function configProblems(env: NodeJS.ProcessEnv = process.env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = env.NODE_ENV === "production";

  for (const k of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) if (!env[k]) errors.push(`${k} is not set`);

  const key = env.APP_ENCRYPTION_KEY;
  if (!key) (prod ? errors : warnings).push("APP_ENCRYPTION_KEY is not set");
  else if (Buffer.from(key, "base64").length !== 32) errors.push("APP_ENCRYPTION_KEY must be 32 random bytes, base64-encoded");

  if (!env.APP_URL) (prod ? errors : warnings).push("APP_URL is not set (invite links and webhooks would point at localhost)");
  else if (prod && !env.APP_URL.startsWith("https://")) errors.push("APP_URL must be an https:// address in production (browsers block the microphone on http)");

  if (env.AI_DEMO_MODE !== "true" && !env.OPENAI_API_KEY) warnings.push("OPENAI_API_KEY is not set: CV and interview scoring will fail (or set AI_DEMO_MODE=true for testing)");
  if (prod && env.AI_DEMO_MODE === "true") warnings.push("AI_DEMO_MODE=true in production: scores are heuristics, not AI assessments");
  if (!env.OMNIDIM_API_KEY) warnings.push("OMNIDIM_API_KEY is not set: voice interviews are disabled");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) warnings.push("SUPABASE_SERVICE_ROLE_KEY is not set: CV files are stored in the database instead of Supabase Storage");
  if (!(env.RESEND_API_KEY && env.EMAIL_FROM) && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM)) {
    warnings.push("No email (Resend) or SMS (Twilio) configured: recruiters must share invite links by hand");
  }
  if (prod && env.DATABASE_SSL !== "true" && !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL ?? "")) warnings.push("DATABASE_SSL is not true for a remote database");
  if (prod && !env.ERROR_WEBHOOK_URL) warnings.push("ERROR_WEBHOOK_URL is not set: errors are only written to logs, nobody is alerted");
  return { errors, warnings };
}

export function checkConfigOrExit() {
  const { errors, warnings } = configProblems();
  // The problem goes in the message itself: log viewers such as Railway's show
  // only the message column, and an unexplained "config" line helps nobody.
  for (const w of warnings) log.warn(`Config warning: ${w}`, { problem: w });
  if (!errors.length) return;
  for (const e of errors) log.error(`Config ERROR: ${e}`, { problem: e });
  if (process.env.NODE_ENV === "production") {
    log.error("Refusing to start with invalid configuration; fix the variables above.");
    process.exit(1);
  }
}
