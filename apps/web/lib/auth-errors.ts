import type { AuthError, AuthWeakPasswordError } from "@supabase/supabase-js";

export const RATE_LIMITED = "Too many attempts. Try again in a few minutes.";
export const SUSPENDED = "This account is suspended. See the email we sent you for the reasons.";
export const GENERIC_FAILURE = "We could not complete this request. Try again.";
export const EMAIL_NOT_SENT = "We could not send the confirmation email. Your account was not created. Try again in a few minutes.";

export function logAuthFailure(action: string, error: AuthError): void {
  console.error(`${action} failed`, { code: error.code, status: error.status });
}

// Auth answers the per-address minimum interval and the hourly email cap with one error code.
export function isAddressThrottle(error: AuthError): boolean {
  return (
    error.code === "over_email_send_rate_limit" &&
    error.message.includes("you can only request this after")
  );
}

// Auth rolls the sign-up back when its mail provider refuses the message, and answers an internal error whose message
// names the email it could not send.
export function isEmailSendFailure(error: AuthError): boolean {
  return error.status === 500 && /^error sending .* email$/i.test(error.message);
}

export function isRateLimit(error: AuthError): boolean {
  return (
    error.code === "over_request_rate_limit" ||
    (error.code === "over_email_send_rate_limit" && !isAddressThrottle(error))
  );
}

export function isWrongCode(error: AuthError): boolean {
  return error.code === "mfa_verification_failed" || error.code === "mfa_challenge_expired";
}

export function weakPasswordMessage(error: AuthWeakPasswordError): string {
  return error.reasons.includes("pwned")
    ? "This password has appeared in a data breach. Choose another one."
    : "Choose a stronger password.";
}
