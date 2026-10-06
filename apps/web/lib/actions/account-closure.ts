"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { settingsPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

type ClosureResult = { message?: string };

const REFUSALS: Record<string, string> = {
  cooling_off_ended: "The time to cancel is over. Your account is being erased.",
  platform_staff: "Your account holds a platform role. Ask an administrator to remove it first.",
};

// Asking for deletion must work for a candidate who has not accepted a new version of the terms yet, so the consent gate
// is off. The database decides who may ask, and a repeated call changes nothing.
async function callClosure(rpc: "request_account_deletion" | "cancel_account_deletion"): Promise<ClosureResult> {
  await requireUser(defaultLocale, { consentGate: false });
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc);
  if (error) {
    console.error("Account closure failed", { rpc, code: error.code, message: error.message });
    return { message: REFUSALS[error.details] ?? GENERIC_FAILURE };
  }
  revalidatePath(settingsPath(defaultLocale));
  return {};
}

export async function requestAccountDeletion(): Promise<ClosureResult> {
  return callClosure("request_account_deletion");
}

export async function cancelAccountDeletion(): Promise<ClosureResult> {
  return callClosure("cancel_account_deletion");
}
