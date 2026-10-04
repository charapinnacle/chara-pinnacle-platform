import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function serviceClient(env: { get(name: string): string | undefined }): SupabaseClient {
  const url = env.get("SUPABASE_URL");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
