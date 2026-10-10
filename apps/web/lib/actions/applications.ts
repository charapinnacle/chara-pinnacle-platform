"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { applyToJob, getApplyLimits, getMyApplication, withdrawApplication, type ApplyRefusal } from "@/lib/dal/applications";
import { requireUser } from "@/lib/dal/session";
import { NOT_ACCEPTING, profileFields } from "@/lib/applications/presentation";
import { defaultLocale } from "@/lib/i18n/locale";
import { applicationPath, applicationsPath } from "@/lib/routes";
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

// The candidate comes from the session, never from the form; a repeated application ends on the application page too,
// so a second press shows the first application, not an error.
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

// The candidate comes from the session and the database checks that the application is theirs. A second press, or a second
// tab, finds the application already withdrawn: that is the outcome the candidate asked for, not an error.
export async function withdrawMyApplication(applicationId: string): Promise<{ message?: string }> {
  await requireUser(defaultLocale);
  const id = z.uuid().safeParse(applicationId);
  if (!id.success) return { message: GENERIC_FAILURE };

  const refusal = await withdrawApplication(id.data);
  revalidatePath(applicationPath(defaultLocale, id.data));
  revalidatePath(applicationsPath(defaultLocale));
  if (!refusal) return {};
  switch (refusal.kind) {
    case "not_found":
      return { message: "This application could not be found." };
    case "not_withdrawable":
      return (await getMyApplication(id.data))?.status === "withdrawn"
        ? {}
        : { message: "This application can no longer be withdrawn. Reload to see its stage." };
    case "failed":
      return { message: GENERIC_FAILURE };
  }
}
