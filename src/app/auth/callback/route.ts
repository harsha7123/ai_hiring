import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirects";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Landing point for Supabase's email links (sign-up confirmation, password
 * recovery). Exchanges the one-time code for a session cookie, then sends the
 * user on to an allow-listed page.
 *
 * Two link styles are supported:
 *  - ?code=…  (Supabase's default PKCE link) — only works in the same browser
 *    that asked for the email, because it needs that browser's code verifier.
 *  - ?token_hash=…&type=…  (set by editing the email templates, see README) —
 *    works in any browser, e.g. a link opened on a phone.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safeNextPath(url.searchParams.get("next"));
  const fail = (reason: string) => {
    const to = url.clone();
    to.pathname = next === "/reset-password" ? "/forgot-password" : "/login";
    to.search = `?error=${encodeURIComponent(reason)}`;
    return NextResponse.redirect(to);
  };

  const supabase = await supabaseServer();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link_expired");
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail("link_expired");
  } else {
    return fail("invalid_link");
  }

  const to = url.clone();
  to.pathname = next;
  to.search = "";
  return NextResponse.redirect(to);
}
