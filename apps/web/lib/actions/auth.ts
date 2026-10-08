"use server";

import { isAuthWeakPasswordError, type AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  EMAIL_NOT_SENT,
  GENERIC_FAILURE,
  isAddressThrottle,
  isEmailSendFailure,
  isRateLimit,
  logAuthFailure,
  RATE_LIMITED,
  weakPasswordMessage,
} from "@/lib/auth-errors";
import { getSignupDocuments } from "@/lib/dal/legal";
import { isThrottled } from "@/lib/dal/rate-limit";
import { defaultLocale } from "@/lib/i18n/locale";
import { rememberInvitation } from "@/lib/invitation-cookie";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/lib/validation/team";
import {
  consentMessage,
  DOCUMENT_CHANGED,
  unacceptedDocuments,
} from "@/lib/validation/consents";
import {
  confirmTokenSchema,
  fieldErrors,
  resendSchema,
  signUpInputSchema,
  type FieldErrors,
  type SignUpInput,
} from "@/lib/validation/sign-up";

type AuthActionResult = { errors?: FieldErrors; message?: string };
type ResendResult = AuthActionResult & { sent?: true };

// invitation is the token of the link the person came from: it is kept for onboarding, which then offers the
// invitation instead of asking for a company of their own. Only an employer registration can use it.
export async function signUp(
  input: SignUpInput,
  invitation?: string,
): Promise<AuthActionResult | undefined> {
  const parsed = signUpInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { kind, email, password, consents } = parsed.data;

  const documents = await getSignupDocuments(kind);
  const missing = unacceptedDocuments(documents, consents);
  if (missing.length > 0) {
    return {
      errors: Object.fromEntries(
        missing.map((document) => [
          `accepted.${document.slug}`,
          consents.some((entry) => entry.purpose === document.slug)
            ? DOCUMENT_CHANGED
            : consentMessage(document),
        ]),
      ),
    };
  }

  if (await isThrottled("signup")) return { message: RATE_LIMITED };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        intended_account_kind: kind,
        pending_consents: documents.map((document) => ({
          purpose: document.slug,
          version: document.version,
        })),
      },
    },
  });

  // A repeat sign-up of an existing or waiting address must look like a new one.
  if (error && error.code !== "user_already_exists" && !isAddressThrottle(error)) {
    return refusal(error);
  }
  const token = invitationTokenSchema.safeParse(invitation);
  if (token.success && kind === "company") await rememberInvitation(token.data);
  redirect(`/${defaultLocale}/verify-email`);
}

function refusal(error: AuthError): AuthActionResult {
  if (isAuthWeakPasswordError(error)) {
    return { errors: { password: weakPasswordMessage(error) } };
  }
  if (isRateLimit(error)) return { message: RATE_LIMITED };
  if (error.code === "email_address_invalid") {
    return { errors: { email: "Enter a valid email address." } };
  }
  logAuthFailure("Sign-up", error);
  return { message: isEmailSendFailure(error) ? EMAIL_NOT_SENT : GENERIC_FAILURE };
}

export async function resendConfirmation(input: {
  email: string;
}): Promise<ResendResult> {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (await isThrottled("resend")) return { message: RATE_LIMITED };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
  });
  if (error && isRateLimit(error)) return { message: RATE_LIMITED };
  if (error && !isAddressThrottle(error)) logAuthFailure("Resend", error);
  // Every other outcome, including an unknown or confirmed address and the
  // per-address minimum interval, answers alike so the form reveals nothing.
  return { sent: true };
}

// The link only opens the confirm page: the single-use token is spent here, by a click, so that mail scanners
// which fetch links in advance cannot use it up.
export async function confirmEmail(formData: FormData): Promise<void> {
  const parsed = confirmTokenSchema.safeParse(formData.get("token_hash"));
  if (parsed.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: "signup",
      token_hash: parsed.data,
    });
    if (!error) redirect(`/${defaultLocale}/onboarding`);
  }
  redirect(`/${defaultLocale}/verify-email?error=invalid_link`);
}
