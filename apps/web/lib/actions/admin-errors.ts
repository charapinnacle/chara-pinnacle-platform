import type { PostgrestError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { defaultLocale } from "@/lib/i18n/locale";
import { mfaPath } from "@/lib/routes";
import type { FieldErrors } from "@/lib/validation/sign-up";

export type AdminResult = { message?: string; errors?: FieldErrors; done?: true };

// What the person is told for a refusal of the database, by the code and the detail it carries ("CHARA_FORBIDDEN:own_account",
// or the code alone). Two-step verification can lapse between loading a page and acting on it; the person is sent to confirm
// it again and returns to the page. Anything not listed is logged with its code, and with its message only when the message is one of ours (CHARA_...), and shown as a failure.
export function adminRefusal(error: PostgrestError, returnTo: string, known: Record<string, AdminResult> = {}): AdminResult {
  if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") {
    redirect(mfaPath(defaultLocale, returnTo));
  }
  const listed = known[`${error.message}:${error.details}`] ?? known[error.message];
  if (listed) return listed;
  if (error.message === "CHARA_FORBIDDEN") return { message: "You are not allowed to do this." };
  if (error.message === "CHARA_NOT_FOUND") return { message: "This record no longer exists." };
  console.error("Administration action failed", { code: error.code, message: /^CHARA_[A-Z_]+$/.test(error.message) ? error.message : undefined });
  return { message: GENERIC_FAILURE };
}
