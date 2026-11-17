"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { findWorkersPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { slugSchema } from "@/lib/validation/team";

type SaveCardResult = { message?: string };

const RELEASE_OFF = "Find Workers is not available at the moment.";

const inputSchema = z.object({
  slug: slugSchema,
  cardId: z.uuid(),
  requirementId: z.uuid().nullable(),
  saved: z.boolean(),
});

// Saves or removes a Find Workers card for the organisation slug, for one of its requirements or for the organisation
// (FR-Q2 AC12). Any member may; toggle_saved_worker_card checks the release, the plan, the card and the requirement again.
export async function setSavedWorkerCard(input: z.input<typeof inputSchema>): Promise<SaveCardResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const { slug, cardId, requirementId, saved } = parsed.data;
  if (!(await isReleased("release_find_workers"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, slug, "member", { mfa: false, hideFromOutsiders: true, partner: "either" });

  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_saved_worker_card", {
    p_org: organization.id,
    p_card: cardId,
    p_saved: saved,
    ...(requirementId ? { p_requirement: requirementId } : {}),
  });
  revalidatePath(findWorkersPath(defaultLocale, organization.slug));
  if (!error) return {};
  if (error.message === "CHARA_NOT_FOUND") return { message: "This worker is no longer visible in Find Workers." };
  if (error.message === "CHARA_INVALID_STATE") return { message: "Cards can no longer be saved for this requirement because it is closed." };
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return { message: "Find Workers is part of the paid plans." };
  return { message: faultMessage(logFault("Saved worker card", error)) };
}
