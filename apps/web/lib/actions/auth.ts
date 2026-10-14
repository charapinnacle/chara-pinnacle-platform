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
import { isThrottled, visitorProof } from "@/lib/dal/rate-limit";
import { logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { rememberInvitation } from "@/lib/invitation-cookie";
import {
  forgetPendingEmail,
  offerPendingEmailAgain,
  rememberPendingEmail,
  resendPending,
  type ResendAnswer,
} from "@/lib/pending-email";
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
  const { data, error } = await supabase.auth.signUp({
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

  // A repeat sign-up of an existing or waiting address must look like a new one. Auth signals a confirmed account with
  // user_already_exists while phone confirmations are off (the local stack) and otherwise with a user without identities;
  // for a waiting account it sends a new confirmation link itself.
  const existing = error?.code === "user_already_exists" || data.user?.identities?.length === 0;
  if (error && !existing && !isAddressThrottle(error)) {
    return refusal(error);
  }
  if (existing) await tellExistingAccount(email);
  const token = invitationTokenSchema.safeParse(invitation);
  if (token.success && kind === "company") await rememberInvitation(token.data);
  await rememberPendingEmail("signup", email);
  redirect(`/${defaultLocale}/verify-email`);
}

// The owner of a confirmed account learns by email that the address is registered, never on screen (D89). The database
// decides whether the address has such an account and mails it at most once per interval; a failure is logged and changes
// nothing that the visitor sees.
async function tellExistingAccount(email: string): Promise<void> {
  const { key, proof } = await visitorProof("account_exists");
  const supabase = await createClient();
  const { error } = await supabase.rpc("notify_existing_account", { p_email: email, p_key: key, p_proof: proof });
  if (error) logFault("Existing-account email", error);
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

// The Resend button of the page after sign-up: the address is the one the sign-up kept in its cookie.
export async function resendSignupEmail(): Promise<ResendAnswer> {
  return resendPending("signup", "resend", "/verify-email", async (email) => {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (!error) await tellExistingAccount(email);
    return error;
  });
}

// "Use a different address" on the page after sign-up: back to the form with the address filled in for a minute.
export async function changeSignupAddress(): Promise<void> {
  await offerPendingEmailAgain("signup");
  redirect(`/${defaultLocale}/signup`);
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
    if (!error) {
      await forgetPendingEmail();
      redirect(`/${defaultLocale}/onboarding`);
    }
  }
  redirect(`/${defaultLocale}/verify-email?error=invalid_link`);
}
