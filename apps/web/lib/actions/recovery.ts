"use server";

import { isAuthWeakPasswordError, type AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  GENERIC_FAILURE,
  isAddressThrottle,
  isRateLimit,
  logAuthFailure,
  RATE_LIMITED,
  weakPasswordMessage,
} from "@/lib/auth-errors";
import { verifyAnyTotp } from "@/lib/dal/mfa";
import { isThrottled } from "@/lib/dal/rate-limit";
import { hasRecoverySession, isRecoveryLinkFresh } from "@/lib/dal/recovery";
import { getCurrentUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordInputSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from "@/lib/validation/login";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type RequestResult = { errors?: FieldErrors; message?: string; sent?: true };
type ResetResult = { errors?: FieldErrors; message?: string; needsCode?: true };

const SAME_PASSWORD = "Choose a password different from your current one.";
const WRONG_CODE = "The code is incorrect or has expired.";
const OTHER_SESSIONS_KEPT =
  "Your password was changed, but we could not sign out your other devices. Request a new reset link and change it again to end them.";

export async function requestPasswordReset(input: ForgotPasswordInput): Promise<RequestResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (await isThrottled("forgot_password")) return { message: RATE_LIMITED };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error && isRateLimit(error)) return { message: RATE_LIMITED };
  if (error && !isAddressThrottle(error)) logAuthFailure("Password reset request", error);
  // Every other outcome, including an unknown address and the per-address minimum interval,
  // answers alike so the form reveals nothing.
  return { sent: true };
}

async function endOtherSessions(supabase: Supabase): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (!error) return true;
    logAuthFailure("Sign-out of other sessions", error);
  }
  return false;
}

function updateRefusal(error: AuthError): ResetResult {
  if (isAuthWeakPasswordError(error)) return { errors: { password: weakPasswordMessage(error) } };
  if (error.code === "same_password") return { errors: { password: SAME_PASSWORD } };
  if (error.code === "insufficient_aal") return { needsCode: true };
  if (isRateLimit(error)) return { message: RATE_LIMITED };
  logAuthFailure("Password reset", error);
  return { message: GENERIC_FAILURE };
}

// The link is spent here, by a click on the form, never when the page opens (mail scanners open links).
// The form is validated first so a mistyped password does not use the link up; once the link is spent,
// the session it opened carries the retries (a refused password, a missing authenticator code).
export async function resetPassword(input: ResetPasswordInput): Promise<ResetResult | undefined> {
  const parsed = resetPasswordInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { tokenHash, password, code } = parsed.data;
  if (await isThrottled("reset_password")) return { message: RATE_LIMITED };

  const supabase = await createClient();
  if (await isRecoveryLinkFresh(tokenHash)) {
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) redirect(`/${defaultLocale}/reset-password`);
  } else if (!(await hasRecoverySession())) {
    redirect(`/${defaultLocale}/reset-password`);
  }

  if (code && !(await verifyAnyTotp(supabase, code))) return { errors: { code: WRONG_CODE } };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return updateRefusal(error);

  if (!(await endOtherSessions(supabase))) return { message: OTHER_SESSIONS_KEPT };

  const user = await getCurrentUser();
  redirect(homePath(defaultLocale, user?.accountKind ?? null));
}
