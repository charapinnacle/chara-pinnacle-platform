import "server-only";
import { AuthApiError, isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { isWrongCode } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/server";
import { MAX_TOTP_FACTORS } from "@/lib/validation/mfa";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type VerifiedFactor = { id: string; name: string; createdAt: string };
type TotpFactors = { verified: VerifiedFactor[]; unverifiedIds: string[] };

export type Enrolment = { factorId: string; qrCode: string; secret: string };
type EnrolmentRefusal = "name_taken" | "too_many" | "aal2_required";

async function loadFactors(supabase: Supabase, lang: string): Promise<TotpFactors> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    if (isAuthSessionMissingError(error) || error.status === 401 || error.status === 403) {
      redirect(`/${lang}/login`);
    }
    throw new Error("The two-step verification status could not be loaded", { cause: error });
  }
  const totp = data.all.filter((factor) => factor.factor_type === "totp");
  return {
    verified: totp
      .filter((factor) => factor.status === "verified")
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .map((factor) => ({ id: factor.id, name: factor.friendly_name ?? "", createdAt: factor.created_at })),
    unverifiedIds: totp.filter((factor) => factor.status === "unverified").map((factor) => factor.id),
  };
}

export async function listVerifiedFactors(lang: string): Promise<VerifiedFactor[]> {
  return (await loadFactors(await createClient(), lang)).verified;
}

export async function hasVerifiedTotpFactor(lang: string): Promise<boolean> {
  return (await listVerifiedFactors(lang)).length > 0;
}

// One submission is one challenge on one factor, so a challenge row that stays unverified is a refused code.
export async function verifyTotp(supabase: Supabase, factorId: string, code: string): Promise<AuthError | null> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  return error;
}

// The reset-password form has one code field and no device choice. Auth refuses a password change at aal1 once a
// verified factor exists, so the code of any of them lifts the session; each factor tried leaves one challenge row.
// A failure other than a wrong code is reported in preference to one, so a rate limit is not shown as a typo.
export async function verifyAnyTotp(supabase: Supabase, code: string): Promise<AuthError | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return error;
  let refusal: AuthError | null = null;
  for (const factor of data.totp) {
    const failure = await verifyTotp(supabase, factor.id, code);
    if (!failure) return null;
    if (!refusal || isWrongCode(refusal)) refusal = failure;
  }
  return refusal ?? new AuthApiError("No verified factor", 422, "mfa_verification_failed");
}

// An enrolment the user walked away from stays unverified and keeps its name; it is dropped here so the new one can
// reuse the name and does not count toward the limit of Auth.
export async function startEnrolment(
  lang: string,
  name: string,
  aal: "aal1" | "aal2",
): Promise<Enrolment | { refused: EnrolmentRefusal }> {
  const supabase = await createClient();
  const { verified, unverifiedIds } = await loadFactors(supabase, lang);
  if (verified.length > 0 && aal !== "aal2") return { refused: "aal2_required" };
  if (verified.length >= MAX_TOTP_FACTORS) return { refused: "too_many" };
  if (verified.some((factor) => factor.name === name)) return { refused: "name_taken" };

  for (const factorId of unverifiedIds) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new Error("An unfinished enrolment could not be removed", { cause: error });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: name });
  if (error) {
    if (error.code === "mfa_factor_name_conflict") return { refused: "name_taken" };
    if (error.code === "too_many_enrolled_mfa_factors") return { refused: "too_many" };
    if (error.code === "insufficient_aal") return { refused: "aal2_required" };
    throw new Error("Two-step verification could not be started", { cause: error });
  }
  return { factorId: data.id, qrCode: data.totp.qr_code.trim(), secret: data.totp.secret };
}
