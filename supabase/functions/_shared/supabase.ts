import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function serviceClient(env: { get(name: string): string | undefined }): SupabaseClient {
  const url = env.get("SUPABASE_URL");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// A client that acts as the caller: the database sees their token, so every policy and every auth.uid() check applies.
// extraHeaders reach the database as request.headers (x-request-id names the request in the audit rows).
export function userClient(
  env: { get(name: string): string | undefined },
  authorization: string,
  extraHeaders: Record<string, string> = {},
): SupabaseClient {
  const url = env.get("SUPABASE_URL");
  const key = env.get("SUPABASE_ANON_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { ...extraHeaders, Authorization: authorization } },
  });
}
