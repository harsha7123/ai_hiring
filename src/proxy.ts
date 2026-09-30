import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Refreshes the Supabase session cookie on every /app request and redirects
// signed-out visitors to /login. Every page, action and route handler still
// re-checks the session against the database before touching tenant data.
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*"],
};
