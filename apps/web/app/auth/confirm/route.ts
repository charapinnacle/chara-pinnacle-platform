import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { defaultLocale } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";

// A `next` parameter is never read: a confirmed sign-up always lands on onboarding.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");

  if (tokenHash && searchParams.get("type") === "signup") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: "signup",
      token_hash: tokenHash,
    });
    if (!error) redirect(`/${defaultLocale}/onboarding`);
  }
  redirect(`/${defaultLocale}/verify-email?error=invalid_link`);
}
