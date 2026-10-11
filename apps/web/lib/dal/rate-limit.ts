import "server-only";
import { headers } from "next/headers";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { attemptProof, clientAddress, visitorKey } from "@/lib/visitor-address";

type ThrottledAction =
  | "signup"
  | "resend"
  | "login"
  | "forgot_password"
  | "reset_password"
  | "mfa_code"
  | "report";

// The keyed hash of this visitor's address and the proof of this minute that the database asks for with it; the address
// itself never leaves the web tier.
export async function visitorProof(action: ThrottledAction): Promise<{ key: string; proof: string }> {
  const { VISITOR_HASH_SECRET, TRUSTED_PROXY_HOPS } = serverEnv();
  const address = clientAddress((await headers()).get("x-forwarded-for"), TRUSTED_PROXY_HOPS);
  if (address === null) {
    console.error("Visitor address missing from X-Forwarded-For", { hops: TRUSTED_PROXY_HOPS });
  }
  const key = visitorKey(VISITOR_HASH_SECRET, address);
  return { key, proof: attemptProof(VISITOR_HASH_SECRET, action, key, Date.now()) };
}

// Counts one attempt of this visitor and gives the seconds to wait when it is over the limit, 0 when it is allowed (limits
// are settings in the database). Called before every Auth call, because Auth's own limits count the web server's one address
// (OPEN_QUESTIONS.md, D20).
export async function throttleWait(action: ThrottledAction): Promise<number> {
  const { key, proof } = await visitorProof(action);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_limit_attempt", { p_action: action, p_key: key, p_proof: proof });
  if (error || data?.length !== 1) throw new Error("The attempt could not be counted");
  return data[0].allowed ? 0 : data[0].retry_after_seconds;
}

export async function isThrottled(action: ThrottledAction): Promise<boolean> {
  return (await throttleWait(action)) > 0;
}
