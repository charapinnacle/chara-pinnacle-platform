"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  GENERIC_FAILURE,
  isRateLimit,
  logAuthFailure,
  RATE_LIMITED,
} from "@/lib/auth-errors";
import { startEnrolment, verifyAnyTotp, type Enrolment } from "@/lib/dal/mfa";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { mfaReturnPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import {
  backupFactorSchema,
  challengeInputSchema,
  NAME_TAKEN,
  TOO_MANY_FACTORS,
  verifyEnrolmentInputSchema,
  WRONG_CODE,
  type BackupFactorFormInput,
  type ChallengeInput,
  type VerifyEnrolmentInput,
} from "@/lib/validation/mfa";

type MfaResult = { errors?: FieldErrors; message?: string };
type StartResult = MfaResult & { enrolment?: Enrolment };
type VerifyResult = MfaResult & { added?: true };

const ENROLMENT_GONE = "This setup is no longer valid. Reload the page to start again.";

function verifyRefusal(error: AuthError): MfaResult {
  if (isRateLimit(error)) return { message: RATE_LIMITED };
  if (error.code === "mfa_verification_failed" || error.code === "mfa_challenge_expired") {
    return { errors: { code: WRONG_CODE } };
  }
  if (error.code === "mfa_factor_not_found") return { message: ENROLMENT_GONE };
  logAuthFailure("Two-step verification", error);
  return { message: GENERIC_FAILURE };
}

export async function startBackupEnrolment(input: BackupFactorFormInput): Promise<StartResult> {
  await requireUser(defaultLocale);
  const parsed = backupFactorSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const started = await startEnrolment(defaultLocale, parsed.data.name);
  if ("refused" in started) {
    return started.refused === "name_taken"
      ? { errors: { name: NAME_TAKEN } }
      : { message: TOO_MANY_FACTORS };
  }
  return { enrolment: started };
}

// A user at aal1 is enrolling the first factor and moves on; a user at aal2 is adding a backup and stays on the page.
export async function verifyEnrolment(input: VerifyEnrolmentInput): Promise<VerifyResult | undefined> {
  const user = await requireUser(defaultLocale);
  const parsed = verifyEnrolmentInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { factorId, code, next } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return verifyRefusal(error);
  if (user.aal === "aal2") return { added: true };
  redirect(mfaReturnPath(defaultLocale, next, homePath(defaultLocale, user.accountKind)));
}

export async function answerChallenge(input: ChallengeInput): Promise<MfaResult | undefined> {
  const user = await requireUser(defaultLocale);
  const parsed = challengeInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { code, next } = parsed.data;

  if (!(await verifyAnyTotp(await createClient(), code))) return { errors: { code: WRONG_CODE } };
  redirect(mfaReturnPath(defaultLocale, next, homePath(defaultLocale, user.accountKind)));
}
