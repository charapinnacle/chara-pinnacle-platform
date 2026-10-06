"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { viewerOf } from "@/lib/jobs/viewer";
import { safeNextPath } from "@/lib/safe-next";
import { jobIdSchema } from "@/lib/validation/job";

const actionSchema = z.enum(["apply", "save"]);

// Apply and Save of a visitor: the press is counted and the visitor goes to log in, to come back to the page the press
// was on (a vacancy page or a page of search results). Any other way back is replaced by the vacancy page. The
// candidate's own Apply takes over from here in the unit of FR-D1.
export async function requireLogin(action: "apply" | "save", jobId: string, next: string): Promise<never> {
  const id = jobIdSchema.safeParse(jobId);
  const parsedAction = actionSchema.safeParse(action);
  if (!id.success || !parsedAction.success) redirect(`/${defaultLocale}/jobs`);
  logVacancy({ event: "vacancy_action", action: parsedAction.data, jobId: id.data, viewer: viewerOf(await getCurrentUser()) });
  const searchPage = `/${defaultLocale}/jobs`;
  const vacancyPage = `${searchPage}/${id.data}`;
  const target = safeNextPath(next);
  const back = target === vacancyPage || target === searchPage || target.startsWith(`${searchPage}?`) ? target : vacancyPage;
  redirect(`/${defaultLocale}/login?next=${encodeURIComponent(back)}`);
}
