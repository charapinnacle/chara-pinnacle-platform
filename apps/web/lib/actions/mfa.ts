"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  GENERIC_FAILURE,
  isRateLimit,
  isWrongCode,
  logAuthFailure,
  RATE_LIMITED,
} from "@/lib/auth-errors";
import { hasVerifiedTotpFactor, listVerifiedFactors, startEnrolment, verifyTotp, type Enrolment } from "@/lib/dal/mfa";
import { isThrottled } from "@/lib/dal/rate-limit";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { mfaReturnPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import {
  AAL2_REQUIRED,
  codeInputSchema,
  enrolmentStartSchema,
  NAME_TAKEN,
  TOO_MANY_FACTORS,
  WRONG_CODE,
  type CodeInput,
  type EnrolmentStartInput,
} from "@/lib/validation/mfa";

type MfaResult = { errors?: FieldErrors; message?: string };
type StartResult = MfaResult & { enrolment?: Enrolment };
type VerifyResult = MfaResult & { added?: true };

const ENROLMENT_GONE = "This setup is no longer valid. Reload the page to start again.";

function verifyRefusal(error: AuthError): MfaResult {
  if (isRateLimit(error)) return { message: RATE_LIMITED };
  if (isWrongCode(error)) return { errors: { code: WRONG_CODE } };
  if (error.code === "mfa_factor_not_found") return { message: ENROLMENT_GONE };
  logAuthFailure("Two-step verification", error);
  return { message: GENERIC_FAILURE };
}

// The first factor needs no earlier proof; every further one needs a session that has passed two-step verification.
export async function startFactorEnrolment(input: EnrolmentStartInput): Promise<StartResult> {
  const user = await requireUser(defaultLocale);
  const parsed = enrolmentStartSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const started = await startEnrolment(defaultLocale, parsed.data.name, user.aal);
  if ("refused" in started) {
    if (started.refused === "name_taken") return { errors: { name: NAME_TAKEN } };
    return { message: started.refused === "too_many" ? TOO_MANY_FACTORS : AAL2_REQUIRED };
  }
  return { enrolment: started };
}

// A user at aal1 is enrolling the first factor and moves on; a user at aal2 is adding a backup and stays on the page.
export async function verifyEnrolment(input: CodeInput): Promise<VerifyResult | undefined> {
  const user = await requireUser(defaultLocale);
  const parsed = codeInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { factorId, code, next } = parsed.data;
  if (await isThrottled("mfa_code")) return { message: RATE_LIMITED };
  if (user.aal !== "aal2" && (await hasVerifiedTotpFactor(defaultLocale))) return { message: AAL2_REQUIRED };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return verifyRefusal(error);
  if (user.aal === "aal2") return { added: true };
  redirect(mfaReturnPath(defaultLocale, next, homePath(defaultLocale, user.accountKind)));
}

export async function answerChallenge(input: CodeInput): Promise<MfaResult | undefined> {
  const user = await requireUser(defaultLocale);
  const parsed = codeInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { factorId, code, next } = parsed.data;
  if (await isThrottled("mfa_code")) return { message: RATE_LIMITED };
  if (!(await listVerifiedFactors(defaultLocale)).some((factor) => factor.id === factorId)) {
    return { message: ENROLMENT_GONE };
  }

  const error = await verifyTotp(await createClient(), factorId, code);
  if (error) return verifyRefusal(error);
  redirect(mfaReturnPath(defaultLocale, next, homePath(defaultLocale, user.accountKind)));
}
