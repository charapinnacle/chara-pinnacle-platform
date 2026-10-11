"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { reportMoveInputSchema, type ReportMoveInput } from "@/lib/validation/report";
import { fieldErrors } from "@/lib/validation/sign-up";

const MOVED = { message: "This report was moved by someone else. Reload the page." } as const;

// Only Trust & Safety acts on a report; the Platform Administrator reads. Every move takes a reason (FR-F1), and the reason
// of a closing is the note that a signed-in reporter reads. The database locks the report and refuses a second move, so of
// two simultaneous calls one finds the new state.
export async function moveReport(input: ReportMoveInput): Promise<AdminResult> {
  const parsed = reportMoveInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, status, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const path = adminPath(defaultLocale, `reports/${id}`);
  const { error } = await (await adminClient()).rpc("admin_set_report_status", { p_id: id, p_status: status, p_note: reason });
  if (error) {
    return adminRefusal(error, path, {
      CHARA_INVALID_STATE: MOVED,
      "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a note of 10 to 2000 characters" } },
    });
  }
  revalidatePath(path);
  return { done: true };
}
