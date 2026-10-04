"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  GENERIC_FAILURE,
  isRateLimit,
  logAuthFailure,
  RATE_LIMITED,
  SUSPENDED,
} from "@/lib/auth-errors";
import { isThrottled } from "@/lib/dal/rate-limit";
import { getCurrentUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import {
  INVALID_CREDENTIALS,
  loginInputSchema,
  type LoginInput,
} from "@/lib/validation/login";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type LoginResult = { errors?: FieldErrors; message?: string; unconfirmed?: true };

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
  if (await isThrottled("login")) return { message: RATE_LIMITED };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return refusal(error);

  const user = await getCurrentUser();
  if (user?.suspended) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: SUSPENDED };
  }

  const target = safeNextPath(next);
  redirect(target === "/" ? homePath(defaultLocale, user?.accountKind ?? null) : target);
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
