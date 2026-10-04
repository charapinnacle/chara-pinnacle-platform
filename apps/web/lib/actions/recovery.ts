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
import { hasRecoverySession, isRecoveryLinkFresh } from "@/lib/dal/recovery";
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

export async function requestPasswordReset(input: ForgotPasswordInput): Promise<RequestResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error && isRateLimit(error)) return { message: RATE_LIMITED };
  if (error && !isAddressThrottle(error)) logAuthFailure("Password reset request", error);
  // Every other outcome, including an unknown address and the per-address minimum interval,
  // answers alike so the form reveals nothing.
  return { sent: true };
}

// Auth refuses a password change at aal1 once a verified factor exists, so the code of any of them lifts the session.
async function verifyTotp(supabase: Supabase, code: string): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  for (const factor of data?.totp ?? []) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (!error) return true;
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

  const supabase = await createClient();
  if (await isRecoveryLinkFresh(tokenHash)) {
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) redirect(`/${defaultLocale}/reset-password`);
  } else if (!(await hasRecoverySession())) {
    redirect(`/${defaultLocale}/reset-password`);
  }

  if (code && !(await verifyTotp(supabase, code))) return { errors: { code: WRONG_CODE } };

  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) return updateRefusal(error);

  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
  if (revokeError) logAuthFailure("Sign-out of other sessions", revokeError);

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_kind")
    .eq("id", data.user.id)
    .maybeSingle();
  redirect(homePath(defaultLocale, profile?.account_kind ?? null));
}
