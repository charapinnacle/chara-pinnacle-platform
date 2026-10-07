"use server";

import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { applyToJob, getApplyLimits, type ApplyRefusal } from "@/lib/dal/applications";
import { requireUser } from "@/lib/dal/session";
import { NOT_ACCEPTING, profileFields } from "@/lib/applications/presentation";
import { defaultLocale } from "@/lib/i18n/locale";
import { applicationPath } from "@/lib/routes";
import { applyInputSchema, type ApplyFormInput } from "@/lib/validation/application";
import { jobIdSchema } from "@/lib/validation/job";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type ApplyActionResult = { errors?: FieldErrors; message?: string; notOpen?: boolean };

function refusalMessage(refusal: ApplyRefusal): ApplyActionResult {
  switch (refusal.kind) {
    case "not_open":
      return { message: NOT_ACCEPTING, notOpen: true };
    case "profile_incomplete": {
      const labels = refusal.missing.map((field) => profileFields[field]?.label.toLowerCase()).filter(Boolean);
      return { message: `Your passport is incomplete${labels.length > 0 ? `: add your ${labels.join(", ")}` : ""}, then apply again.` };
    }
    case "rate_limited":
      return { message: "You have sent many applications in a short time. Try again later." };
    case "document_not_found":
      return { message: "One of the selected documents is no longer available. Reload the page and choose again." };
    case "forbidden":
      return { message: "Only an active candidate account can apply." };
    case "failed":
      return { message: GENERIC_FAILURE };
  }
}

// The candidate comes from the session and the vacancy from the address; the form sends the note, the documents and the
// consent. Success and a repeated application both end on the application page: the second one with a notice.
export async function applyToVacancy(jobId: string, input: ApplyFormInput): Promise<ApplyActionResult | undefined> {
  const id = jobIdSchema.safeParse(jobId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const user = await requireUser(defaultLocale);
  if (user.accountKind !== "worker") return { message: "Only candidates can apply for vacancies." };

  const parsed = applyInputSchema(await getApplyLimits()).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const result = await applyToJob(id.data, parsed.data.coverNote, parsed.data.documentIds);
  if (result.kind === "created" || result.kind === "existing") {
    const path = applicationPath(defaultLocale, result.applicationId);
    redirect(result.kind === "existing" ? `${path}?existing=1` : path);
  }
  return refusalMessage(result);
}
