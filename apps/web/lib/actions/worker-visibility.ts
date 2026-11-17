"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export type VisibilityResult = { message: string } | { message?: undefined; visible: boolean; visibleSince: string | null };
export type SectionsResult = { message?: string };

const RELEASE_OFF = "Find Workers is not available at the moment.";
const WORDING_CHANGED = "The consent text has changed. Reload the page and read the current version before you turn this on.";
const NOT_ACTIVE = "Your card cannot be shown while your account is suspended or being deleted.";

const visibilitySchema = z.object({ visible: z.boolean(), version: z.number().int().nonnegative().nullable() });
const storedSchema = z.object({ visible: z.boolean(), visible_since: z.string().nullable() });
const sectionsSchema = z.object({ training: z.boolean(), employmentHistory: z.boolean(), industries: z.boolean() });

function refusal(error: PostgrestError, action: string): string {
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return RELEASE_OFF;
  if (error.message === "CHARA_FORBIDDEN" && error.details === "profile_not_active") return NOT_ACTIVE;
  if (error.message === "CHARA_CONSENT_REQUIRED") return WORDING_CHANGED;
  return faultMessage(logFault(action, error));
}

function settle(): void {
  revalidatePath(`/${defaultLocale}/passport`);
  revalidatePath(homePath(defaultLocale, "worker"));
}

// Turns the worker's own Find Workers card on with the version of the consent the worker read, or off (FR-Q1 AC2, AC6).
// The database checks the caller, the account and the version again and writes the consent row and the audit row.
export async function setWorkerVisibility(visible: boolean, version: number | null): Promise<VisibilityResult> {
  const parsed = visibilitySchema.safeParse({ visible, version });
  if (!parsed.success) return { message: GENERIC_FAILURE };
  await requireUser(defaultLocale);
  if (!(await isReleased("release_find_workers"))) return { message: RELEASE_OFF };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_worker_visibility", {
    p_visible: parsed.data.visible,
    ...(parsed.data.version === null ? {} : { p_version: parsed.data.version }),
  });
  if (error) return { message: refusal(error, "Find Workers visibility change") };
  settle();
  const stored = storedSchema.parse(data);
  return { visible: stored.visible, visibleSince: stored.visible_since };
}

// The optional sections of the card (FR-Q1 AC5).
export async function setCardSections(sections: { training: boolean; employmentHistory: boolean; industries: boolean }): Promise<SectionsResult> {
  const parsed = sectionsSchema.safeParse(sections);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  await requireUser(defaultLocale);
  if (!(await isReleased("release_find_workers"))) return { message: RELEASE_OFF };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_card_sections", {
    p_training: parsed.data.training,
    p_employment_history: parsed.data.employmentHistory,
    p_industries: parsed.data.industries,
  });
  if (error) return { message: refusal(error, "Find Workers card sections change") };
  settle();
  return {};
}
