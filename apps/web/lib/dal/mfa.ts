import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function hasVerifiedTotpFactor(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error("The two-step verification status could not be loaded", { cause: error });
  return data.totp.length > 0;
}
