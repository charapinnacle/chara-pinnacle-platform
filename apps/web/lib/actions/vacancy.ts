"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { viewerOf } from "@/lib/jobs/viewer";
import { applyPath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";
import { jobIdSchema } from "@/lib/validation/job";

const actionSchema = z.enum(["apply", "save"]);

// Apply and Save of a visitor: the press is counted and the visitor goes to log in. Apply comes back to the apply form of
// the vacancy (FR-D1); Save comes back to the page the press was on (a vacancy page or a page of search results), and any
// other way back is replaced by the vacancy page.
export async function requireLogin(action: "apply" | "save", jobId: string, next: string): Promise<never> {
  const id = jobIdSchema.safeParse(jobId);
  const parsedAction = actionSchema.safeParse(action);
  if (!id.success || !parsedAction.success) redirect(`/${defaultLocale}/jobs`);
  logVacancy({ event: "vacancy_action", action: parsedAction.data, jobId: id.data, viewer: viewerOf(await getCurrentUser()) });
  const searchPage = `/${defaultLocale}/jobs`;
  const vacancyPage = `${searchPage}/${id.data}`;
  const target = safeNextPath(next);
  const savedBack = target === vacancyPage || target === searchPage || target.startsWith(`${searchPage}?`) ? target : vacancyPage;
  const back = parsedAction.data === "apply" ? applyPath(defaultLocale, id.data) : savedBack;
  redirect(`/${defaultLocale}/login?next=${encodeURIComponent(back)}`);
}
