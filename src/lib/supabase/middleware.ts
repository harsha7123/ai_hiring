import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request that hits the proxy and
 * writes the (possibly rotated) auth cookie onto the response. Required
 * because Server Components cannot write cookies themselves — see
 * lib/supabase/server.ts.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { response, user: null };

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Must call getUser() (not getSession()) here: it revalidates against Supabase
  // rather than trusting the cookie's local JWT, which is what actually triggers
  // the refresh this function exists to perform.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { response, user };
}
