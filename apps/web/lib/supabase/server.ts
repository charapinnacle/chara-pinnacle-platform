import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

// extraHeaders travel with every request of the client; the console passes the request id so that an audit row can be
// matched to the request that caused it.
export async function createClient(extraHeaders?: Record<string, string>) {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: extraHeaders ? { headers: extraHeaders } : undefined,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, sessionCookieOptions(options)),
            );
          } catch {
            // Server Components cannot write cookies; the proxy refreshes the session.
          }
        },
      },
    },
  );
}
