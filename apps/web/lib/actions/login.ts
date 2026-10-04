"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  GENERIC_FAILURE,
  isRateLimit,
  logAuthFailure,
  RATE_LIMITED,
} from "@/lib/auth-errors";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { loginInputSchema, type LoginInput } from "@/lib/validation/login";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type LoginResult = { errors?: FieldErrors; message?: string; unconfirmed?: true };

const INVALID_CREDENTIALS = "Email or password is incorrect.";
const SUSPENDED = "This account is suspended. See the email we sent you for the reasons.";
const UNCONFIRMED = "Confirm your email address before you log in.";

function refusal(error: AuthError): LoginResult {
  if (isRateLimit(error)) return { message: RATE_LIMITED };
  if (error.code === "invalid_credentials") return { message: INVALID_CREDENTIALS };
  if (error.code === "email_not_confirmed") return { message: UNCONFIRMED, unconfirmed: true };
  // Auth checks the sign-in ban before the password, so a suspended account is told apart whatever was typed.
  if (error.code === "user_banned") return { message: SUSPENDED };
  logAuthFailure("Login", error);
  return { message: GENERIC_FAILURE };
}

export async function signIn(input: LoginInput): Promise<LoginResult | undefined> {
  const parsed = loginInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { email, password, next } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return refusal(error);

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_kind, status")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile?.status === "suspended") {
    await supabase.auth.signOut({ scope: "local" });
    return { message: SUSPENDED };
  }

  const target = safeNextPath(next);
  redirect(target === "/" ? homePath(defaultLocale, profile?.account_kind ?? null) : target);
}

export async function signOut(): Promise<{ message: string } | undefined> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    logAuthFailure("Logout", error);
    return { message: GENERIC_FAILURE };
  }
  redirect(`/${defaultLocale}/login`);
}
