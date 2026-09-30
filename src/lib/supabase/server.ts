import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  return { url, anonKey };
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Reads the auth cookie via Next's async cookies() API and writes refreshed
 * tokens back to it. Create a fresh instance per request — never module-level.
 */
export async function supabaseServer() {
  const jar = await cookies();
  const { url, anonKey } = env();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) jar.set(name, value, options);
        } catch {
          // Called from a Server Component render, where cookies can't be written.
          // Session refresh is instead handled by the proxy (middleware) on every request.
        }
      },
    },
  });
}

/**
 * Admin client using the service role key. Bypasses Row Level Security — use only
 * for server-side operations that must act outside a user's own session, such as
 * creating an account during invite acceptance. Never expose this key to the client.
 */
export function supabaseAdmin() {
  const { url } = env();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createServerClient(url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
