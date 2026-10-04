import "server-only";
import { createClient } from "@/lib/supabase/server";
import { confirmTokenSchema } from "@/lib/validation/sign-up";

// A session opened by a recovery link may finish the password change for this long after the link is spent.
const RECOVERY_SESSION_SECONDS = 900;

// Asks the database, without spending the token, whether a recovery link is unused, current and under an hour old.
export async function isRecoveryLinkFresh(tokenHash: string): Promise<boolean> {
  if (!confirmTokenSchema.safeParse(tokenHash).success) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recovery_link_is_fresh", {
    p_token_hash: tokenHash,
  });
  if (error) throw new Error("The recovery link could not be checked");
  return data === true;
}

// The retries after a refused password or a missing authenticator code run on the session the spent link opened.
export async function hasRecoverySession(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const otp = data?.claims.amr?.find(
    (entry) => typeof entry === "object" && entry.method === "otp",
  );
  return (
    typeof otp === "object" && Date.now() / 1000 - otp.timestamp < RECOVERY_SESSION_SECONDS
  );
}
