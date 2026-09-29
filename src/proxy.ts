import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only (cookie present). Every page, action and route handler
// validates the session against the database before touching tenant data.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("sl_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
