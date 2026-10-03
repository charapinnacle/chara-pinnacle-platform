"use server";

import { isAuthWeakPasswordError, type AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getSignupDocuments } from "@/lib/dal/legal";
import { defaultLocale } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { consentMessage, unacceptedDocuments } from "@/lib/validation/consents";
import {
  fieldErrors,
  resendSchema,
  signUpInputSchema,
  type FieldErrors,
  type SignUpInput,
} from "@/lib/validation/sign-up";

type AuthActionResult = { errors?: FieldErrors; message?: string };
type ResendResult = AuthActionResult & { sent?: true };

const RATE_LIMITED = "Too many attempts. Try again in a few minutes.";
const BREACHED_PASSWORD =
  "This password has appeared in a data breach. Choose another one.";
const GENERIC_FAILURE = "We could not complete this request. Try again.";


export async function signUp(
  input: SignUpInput,
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
          consentMessage(document),
        ]),
      ),
    };
  }

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
  redirect(`/${defaultLocale}/verify-email`);
}

// Auth answers the per-address minimum interval and the hourly email cap with one error code.
function isAddressThrottle(error: AuthError): boolean {
  return (
    error.code === "over_email_send_rate_limit" &&
    error.message.includes("you can only request this after")
  );
}

function isRateLimit(error: AuthError): boolean {
  return (
    error.code === "over_request_rate_limit" ||
    (error.code === "over_email_send_rate_limit" && !isAddressThrottle(error))
  );
}

function refusal(error: AuthError): AuthActionResult {
  if (isAuthWeakPasswordError(error)) {
    return {
      errors: {
        password: error.reasons.includes("pwned")
          ? BREACHED_PASSWORD
          : "Choose a stronger password.",
      },
    };
  }
  if (isRateLimit(error)) return { message: RATE_LIMITED };
  if (error.code === "email_address_invalid") {
    return { errors: { email: "Enter a valid email address." } };
  }
  return { message: GENERIC_FAILURE };
}

export async function resendConfirmation(input: {
  email: string;
}): Promise<ResendResult> {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
  });
  if (error && isRateLimit(error)) return { message: RATE_LIMITED };
  // Every other outcome, including an unknown or confirmed address and the
  // per-address minimum interval, answers alike so the form reveals nothing.
  return { sent: true };
}
