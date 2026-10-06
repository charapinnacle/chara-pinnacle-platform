"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { viewerOf } from "@/lib/jobs/viewer";
import { jobIdSchema } from "@/lib/validation/job";

const actionSchema = z.enum(["apply", "save"]);

// Apply and Save of a visitor: the press is counted and the visitor goes to log in, to come back to the vacancy. The
// candidate's own Apply and Save take over from here in the units of FR-C5 and FR-D1.
export async function requireLogin(action: "apply" | "save", jobId: string): Promise<never> {
  const id = jobIdSchema.safeParse(jobId);
  const parsedAction = actionSchema.safeParse(action);
  if (!id.success || !parsedAction.success) redirect(`/${defaultLocale}/jobs`);
  logVacancy({ event: "vacancy_action", action: parsedAction.data, jobId: id.data, viewer: viewerOf(await getCurrentUser()) });
  redirect(`/${defaultLocale}/login?next=${encodeURIComponent(`/${defaultLocale}/jobs/${id.data}`)}`);
}
