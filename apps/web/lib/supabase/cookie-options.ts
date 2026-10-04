import type { CookieOptions } from "@supabase/ssr";
import { env } from "@/lib/env";

const SESSION_COOKIE_MAX_AGE = 604_800;

// @supabase/ssr stamps every cookie it writes with a 400-day lifetime; the session ends after 7 days (FR-A3), so
// the adapters rewrite it. A removal keeps Max-Age 0. The cookies stay readable by the browser client (ARCHITECTURE 6.2).
export function sessionCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    maxAge: options.maxAge === 0 ? 0 : SESSION_COOKIE_MAX_AGE,
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https:"),
  };
}
