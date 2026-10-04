import { NextResponse, type NextRequest } from "next/server";
import { logAuthFailure } from "@/lib/auth-errors";
import { isThrottled } from "@/lib/dal/rate-limit";
import { getCurrentUser } from "@/lib/dal/session";
import { env } from "@/lib/env";
import {
  googleErrorCode,
  hasVerifiedGoogleEmail,
  type GoogleErrorCode,
} from "@/lib/google-sign-in";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { confirmTokenSchema } from "@/lib/validation/sign-up";

function to(path: string) {
  return NextResponse.redirect(new URL(path, env.NEXT_PUBLIC_SITE_URL));
}

function refused(error: GoogleErrorCode) {
  return to(`/${defaultLocale}/login?error=${error}`);
}

// The return of the Google sign-in (PKCE): Auth sends the browser here with a one-time code, or with an error. The
// destination is never taken from the request: an account with no kind goes to onboarding, every other to its dashboard.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) return refused(googleErrorCode(providerError));

  const code = confirmTokenSchema.safeParse(searchParams.get("code"));
  if (!code.success) return refused("failed");
  if (await isThrottled("login")) return refused("rate_limited");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code.data);
  if (error) {
    logAuthFailure("Google sign-in", error);
    return refused(googleErrorCode(error.code));
  }
  if (!hasVerifiedGoogleEmail(data.user)) {
    await supabase.auth.signOut({ scope: "local" });
    return refused("email_unverified");
  }

  const user = await getCurrentUser();
  if (user?.suspended) {
    await supabase.auth.signOut({ scope: "local" });
    return refused("suspended");
  }
  return to(homePath(defaultLocale, user?.accountKind ?? null));
}
