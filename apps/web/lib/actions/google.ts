"use server";

import { redirect } from "next/navigation";
import { logAuthFailure } from "@/lib/auth-errors";
import { isThrottled } from "@/lib/dal/rate-limit";
import { env, googleSignInEnabled } from "@/lib/env";
import type { GoogleErrorCode } from "@/lib/google-sign-in";
import { defaultLocale } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";

function backToLogin(error: GoogleErrorCode): never {
  redirect(`/${defaultLocale}/login?error=${error}`);
}

// Starts the PKCE flow on the server: the code verifier is stored in the session cookies here and the browser is
// sent to Auth's authorize URL, which sends it on to Google. The same address serves sign-up and log-in.
export async function continueWithGoogle(): Promise<void> {
  if (!googleSignInEnabled()) backToLogin("unavailable");
  if (await isThrottled("login")) backToLogin("rate_limited");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback` },
  });
  if (error) {
    logAuthFailure("Google sign-in start", error);
    backToLogin("failed");
  }
  redirect(data.url);
}
