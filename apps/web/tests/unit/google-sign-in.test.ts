import { describe, expect, it } from "vitest";
import { RATE_LIMITED, SUSPENDED } from "@/lib/auth-errors";
import {
  GOOGLE_ERRORS,
  googleErrorCode,
  hasVerifiedGoogleEmail,
  isGoogleErrorCode,
} from "@/lib/google-sign-in";

function user(confirmed: boolean, identities: { provider: string; email_verified?: unknown }[]) {
  return {
    email_confirmed_at: confirmed ? "2026-10-04T10:00:00Z" : undefined,
    identities: identities.map(({ provider, email_verified }) => ({
      id: provider,
      user_id: "u",
      identity_id: provider,
      provider,
      identity_data: { email_verified },
    })),
  };
}

describe("googleErrorCode", () => {
  it.each([
    ["access_denied", "cancelled"],
    ["provider_email_needs_verification", "email_unverified"],
    ["user_banned", "suspended"],
    ["signup_disabled", "unavailable"],
    ["provider_disabled", "unavailable"],
    ["oauth_provider_not_supported", "unavailable"],
    ["over_request_rate_limit", "rate_limited"],
    ["flow_state_not_found", "failed"],
    ["server_error", "failed"],
  ])("maps %s to %s", (authError, expected) => {
    expect(googleErrorCode(authError)).toBe(expected);
  });

  it("treats a missing or unknown error as a plain failure", () => {
    expect(googleErrorCode(undefined)).toBe("failed");
    expect(googleErrorCode(null)).toBe("failed");
    expect(googleErrorCode("<script>alert(1)</script>")).toBe("failed");
  });

  it("shows the messages the other flows already use for a suspended account and a rate limit", () => {
    expect(GOOGLE_ERRORS.suspended).toBe(SUSPENDED);
    expect(GOOGLE_ERRORS.rate_limited).toBe(RATE_LIMITED);
  });
});

describe("isGoogleErrorCode", () => {
  it("accepts only the codes of GOOGLE_ERRORS, so the login page never shows text from the URL", () => {
    expect(isGoogleErrorCode("cancelled")).toBe(true);
    expect(isGoogleErrorCode("toString")).toBe(false);
    expect(isGoogleErrorCode("Your account is hacked")).toBe(false);
    expect(isGoogleErrorCode(undefined)).toBe(false);
    expect(isGoogleErrorCode(["cancelled"])).toBe(false);
  });
});

describe("hasVerifiedGoogleEmail", () => {
  it("accepts a confirmed account with a Google identity whose email is verified", () => {
    expect(hasVerifiedGoogleEmail(user(true, [{ provider: "google", email_verified: true }]))).toBe(true);
    expect(
      hasVerifiedGoogleEmail(
        user(true, [{ provider: "email" }, { provider: "google", email_verified: true }]),
      ),
    ).toBe(true);
  });

  it("refuses a Google identity whose email Google did not verify", () => {
    expect(hasVerifiedGoogleEmail(user(true, [{ provider: "google", email_verified: false }]))).toBe(false);
    expect(hasVerifiedGoogleEmail(user(true, [{ provider: "google" }]))).toBe(false);
    expect(hasVerifiedGoogleEmail(user(true, [{ provider: "google", email_verified: "true" }]))).toBe(false);
  });

  it("refuses an account whose email is not confirmed, whatever the identity says", () => {
    expect(hasVerifiedGoogleEmail(user(false, [{ provider: "google", email_verified: true }]))).toBe(false);
  });

  it("refuses an account without a Google identity", () => {
    expect(hasVerifiedGoogleEmail(user(true, [{ provider: "email", email_verified: true }]))).toBe(false);
    expect(hasVerifiedGoogleEmail({ email_confirmed_at: "2026-10-04T10:00:00Z", identities: undefined })).toBe(false);
  });
});
