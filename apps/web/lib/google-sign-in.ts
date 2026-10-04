import type { User } from "@supabase/supabase-js";
import { RATE_LIMITED, SUSPENDED } from "@/lib/auth-errors";

export const GOOGLE_ERRORS = {
  cancelled: "Google sign-in was cancelled. You can try again or log in with your email and password.",
  email_unverified:
    "Google has not verified this email address, so it cannot be used to sign in. Verify it with Google and try again.",
  suspended: SUSPENDED,
  unavailable: "Sign-in with Google is not available right now. Use your email and password instead.",
  rate_limited: RATE_LIMITED,
  failed: "We could not sign you in with Google. Try again.",
} as const;

export type GoogleErrorCode = keyof typeof GOOGLE_ERRORS;

export function isGoogleErrorCode(value: unknown): value is GoogleErrorCode {
  return typeof value === "string" && Object.hasOwn(GOOGLE_ERRORS, value);
}

// Maps what Auth puts in the callback URL (`error`, `error_code`) or in the error of the code exchange (`code`)
// to a code the login page can show; anything unknown is a plain failure, never the provider's own text.
export function googleErrorCode(authError: string | null | undefined): GoogleErrorCode {
  switch (authError) {
    case "access_denied":
      return "cancelled";
    case "provider_email_needs_verification":
      return "email_unverified";
    case "user_banned":
      return "suspended";
    case "signup_disabled":
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return "unavailable";
    case "over_request_rate_limit":
      return "rate_limited";
    default:
      return "failed";
  }
}

// Auth links a Google sign-in to an existing account only when the address is verified, but this is checked again
// on the session it issued: both the account address and the Google identity must be verified.
export function hasVerifiedGoogleEmail(user: Pick<User, "email_confirmed_at" | "identities">): boolean {
  const google = user.identities?.find((identity) => identity.provider === "google");
  return Boolean(user.email_confirmed_at) && google?.identity_data?.email_verified === true;
}
