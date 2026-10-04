import "server-only";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function hasVerifiedTotpFactor(lang: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    if (isAuthSessionMissingError(error) || error.status === 401 || error.status === 403) {
      redirect(`/${lang}/login`);
    }
    throw new Error("The two-step verification status could not be loaded", { cause: error });
  }
  return data.totp.length > 0;
}
