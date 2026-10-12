import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// A client that holds no session, for public data that is read once for all visitors and cached: a cached value must
// never depend on who asked.
export const anonymousClient = () =>
  createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
