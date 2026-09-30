import type { AuthError } from "@supabase/supabase-js";

/** Friendly copy for the Supabase Auth error codes this app can actually hit. */
export function friendlyAuthError(error: AuthError): string {
  switch (error.code) {
    case "user_already_exists":
      return "An account with this email already exists. Sign in instead.";
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the link we sent.";
    case "weak_password":
      return "Choose a stronger password (at least 10 characters, with letters and a number).";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a few minutes and try again.";
    case "signup_disabled":
      return "Self-service sign-up is disabled. Ask your administrator for an invite.";
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}
