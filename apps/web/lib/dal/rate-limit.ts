import "server-only";
import { headers } from "next/headers";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { clientAddress, visitorKey } from "@/lib/visitor-address";

type ThrottledAction =
  | "signup"
  | "resend"
  | "login"
  | "forgot_password"
  | "reset_password";

// Counts one attempt of this visitor and says whether it is over the limit (limits are settings in the database).
// Called before every Auth call, because Auth's own limits count the web server's one address (OPEN_QUESTIONS.md, D20).
export async function isThrottled(action: ThrottledAction): Promise<boolean> {
  const { VISITOR_HASH_SECRET, TRUSTED_PROXY_HOPS } = serverEnv();
  const address = clientAddress((await headers()).get("x-forwarded-for"), TRUSTED_PROXY_HOPS);
  if (address === null) {
    console.error("Visitor address missing from X-Forwarded-For", { hops: TRUSTED_PROXY_HOPS });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_limit_attempt", {
    p_action: action,
    p_key: visitorKey(VISITOR_HASH_SECRET, address),
  });
  if (error || data?.length !== 1) throw new Error("The attempt could not be counted");
  return !data[0].allowed;
}
