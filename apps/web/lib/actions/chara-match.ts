"use server";

import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { charaMatchPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  charaMatchFormSchema,
  toCharaMatchArgs,
  type CharaMatchFormInput,
  type CharaMatchFormValues,
} from "@/lib/validation/chara-match";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

// One of: field errors, the address of the run, a refusal the form explains (plan, limit), or a message to toast.
export type CharaMatchResult = {
  errors?: FieldErrors;
  message?: string;
  refused?: "not_in_plan" | "rate_limited";
  runHref?: string;
};

export const CHARA_MATCH_UNAVAILABLE = "CHARA Match is not available for this organisation.";

// The argument chara_match names in a refusal of its input, as the field of the form.
const inputFields: Record<string, keyof CharaMatchFormValues> = {
  p_destination: "destination",
  p_industry: "industry",
  p_occupation: "occupation",
  p_workers: "workers",
  p_start: "start",
  p_recruitment: "recruitment",
};

// Runs CHARA Match for the employer of the address (ARCHITECTURE.md section 9.3): any member, while CHARA Match and the
// partner directories are released; chara_match checks all of it again, with the plan, the limit and the input.
export async function runCharaMatch(slug: string, input: CharaMatchFormInput): Promise<CharaMatchResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  const [released, directories] = await Promise.all([isReleased("release_chara_match"), isReleased("release_partner_directories")]);
  if (!released || !directories) return { message: CHARA_MATCH_UNAVAILABLE };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { mfa: false, hideFromOutsiders: true });

  const parsed = charaMatchFormSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chara_match", { p_org: organization.id, ...toCharaMatchArgs(parsed.data) }).single();
  if (error) {
    if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return { refused: "not_in_plan" };
    if (error.message === "CHARA_RATE_LIMITED") return { refused: "rate_limited" };
    const field = error.message === "CHARA_INVALID_INPUT" ? inputFields[error.details ?? ""] : undefined;
    if (field) return { errors: { [field]: "Check this value and try again." } };
    if (error.message === "CHARA_FORBIDDEN" || error.code === "P0002") return { message: CHARA_MATCH_UNAVAILABLE };
    return { message: faultMessage(logFault("CHARA Match", error)) };
  }
  return { runHref: charaMatchPath(defaultLocale, organization.slug, new URLSearchParams({ run: data.run_id }).toString()) };
}
