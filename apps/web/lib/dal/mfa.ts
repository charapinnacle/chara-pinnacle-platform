import "server-only";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { logAuthFailure } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/server";
import { MAX_TOTP_FACTORS } from "@/lib/validation/mfa";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type VerifiedFactor = { id: string; name: string; createdAt: string };
type TotpFactors = { verified: VerifiedFactor[]; unverifiedIds: string[] };

export type Enrolment = { factorId: string; qrCode: string; secret: string };
type EnrolmentRefusal = "name_taken" | "too_many";

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

// Auth refuses a password change at aal1 once a verified factor exists, so the code of any of them lifts the session.
export async function verifyAnyTotp(supabase: Supabase, code: string): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  for (const factor of data?.totp ?? []) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (!error) return true;
    if (error.code !== "mfa_verification_failed") logAuthFailure("Authenticator code check", error);
  }
  return false;
}

// An enrolment the user walked away from stays unverified and keeps its name; it is dropped here so the new one can
// reuse the name and does not count toward the limit of Auth.
export async function startEnrolment(
  lang: string,
  name: string,
): Promise<Enrolment | { refused: EnrolmentRefusal }> {
  const supabase = await createClient();
  const { verified, unverifiedIds } = await loadFactors(supabase, lang);
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
    throw new Error("Two-step verification could not be started", { cause: error });
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}
