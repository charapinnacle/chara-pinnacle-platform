"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { applyRefusalResult, type ApplyActionResult } from "@/lib/applications/apply-refusal";
import { applyToJob, getApplyLimits, getMyApplication, withdrawApplication } from "@/lib/dal/applications";
import { requireUser } from "@/lib/dal/session";
import { faultMessage } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { applicationPath, applicationsPath } from "@/lib/routes";
import { applyInputSchema, type ApplyFormInput } from "@/lib/validation/application";
import { jobIdSchema } from "@/lib/validation/job";
import { fieldErrors } from "@/lib/validation/sign-up";

const NOT_FOUND = "This application could not be found.";

// The candidate comes from the session, never from the form; a repeated application ends on the application page too,
// so a second press shows the first application, not an error.
export async function applyToVacancy(jobId: string, input: ApplyFormInput): Promise<ApplyActionResult | undefined> {
  const id = jobIdSchema.safeParse(jobId);
  if (!id.success) return applyRefusalResult({ kind: "not_open" }, defaultLocale);
  const user = await requireUser(defaultLocale);
  if (user.accountKind !== "worker") return { message: "Only candidates can apply for vacancies." };

  const parsed = applyInputSchema(await getApplyLimits()).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const result = await applyToJob(id.data, parsed.data.coverNote, parsed.data.documentIds);
  if (result.kind === "created" || result.kind === "existing") {
    const path = applicationPath(defaultLocale, result.applicationId);
    redirect(result.kind === "existing" ? `${path}?existing=1` : path);
  }
  return applyRefusalResult(result, defaultLocale);
}

// The candidate comes from the session and the database checks that the application is theirs. A second press, or a second
// tab, finds the application already withdrawn: that is the outcome the candidate asked for, not an error.
export async function withdrawMyApplication(applicationId: string): Promise<{ message?: string }> {
  await requireUser(defaultLocale);
  const id = z.uuid().safeParse(applicationId);
  if (!id.success) return { message: NOT_FOUND };

  const refusal = await withdrawApplication(id.data);
  revalidatePath(applicationPath(defaultLocale, id.data));
  revalidatePath(applicationsPath(defaultLocale));
  if (!refusal) return {};
  switch (refusal.kind) {
    case "not_found":
      return { message: NOT_FOUND };
    case "not_withdrawable":
      return (await getMyApplication(id.data))?.status === "withdrawn"
        ? {}
        : { message: "This application can no longer be withdrawn. Reload to see its stage." };
    case "fault":
      return { message: faultMessage(refusal.reference) };
  }
}
