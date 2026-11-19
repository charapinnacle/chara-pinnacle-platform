"use server";

import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { onboardingPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { commitmentSchema, type CommitmentInput } from "@/lib/validation/commitment";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type AcceptCommitmentResult = { errors?: FieldErrors; message?: string; accepted?: boolean };

const RELEASE_OFF = "Registration for recruitment and staffing companies is not open at the moment.";
const SUSPENDED = "This organisation is suspended, so the commitment cannot be accepted.";
const CHANGED = "The commitment has changed since this page was opened. Reload the page to read the current version.";

// The owner accepts the employer-pays commitment (FR-J3) in the version the page showed. The organisation comes from the
// slug, checked against the caller's membership and the owner role; aal1 is enough (onboarding comes before the Security
// step), and the database checks all of it again. A newer version published meanwhile is refused, so nobody accepts a
// text they did not see.
async function accept(slug: string, version: number, input: CommitmentInput): Promise<AcceptCommitmentResult | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success || !Number.isInteger(version) || version < 0) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "owner", {
    mfa: false,
    hideFromOutsiders: true,
    partner: true,
  });
  const parsed = commitmentSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_employer_pays_commitment", { p_org: organization.id, p_version: version });
  if (!error) return null;
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "version") return { message: CHANGED };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
  console.error("Accepting the commitment failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

// From the Commitments step of onboarding, which then shows its next step.
export async function acceptCommitment(
  slug: string,
  version: number,
  input: CommitmentInput,
): Promise<AcceptCommitmentResult | undefined> {
  const refused = await accept(slug, version, input);
  if (refused) return refused;
  redirect(onboardingPath(defaultLocale));
}

// From the dialog of a page past onboarding (FR-J3 AC4, FR-S4 AC7): the page stays, and the client refreshes it so that
// responding and submitting open again.
export async function acceptUpdatedCommitment(
  slug: string,
  version: number,
  input: CommitmentInput,
): Promise<AcceptCommitmentResult> {
  return (await accept(slug, version, input)) ?? { accepted: true };
}
