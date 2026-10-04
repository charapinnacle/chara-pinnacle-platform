"use server";

import { redirect } from "next/navigation";
import { getPendingReconsents, getSignupDocuments } from "@/lib/dal/legal";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { consentReturnPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { accountKindSchema } from "@/lib/validation/sign-up";
import {
  consentEntriesSchema,
  consentMessage,
  DOCUMENT_CHANGED,
  unacceptedDocuments,
  type ConsentEntry,
} from "@/lib/validation/consents";

export type ConsentActionResult = { error: string } | undefined;

const GENERIC_FAILURE = "We could not save this step. Try again.";

function describe(code: string): string {
  return code === "CHARA_CONSENT_REQUIRED" ? DOCUMENT_CHANGED : GENERIC_FAILURE;
}

export async function commitAccountKind(
  entries: ConsentEntry[],
): Promise<ConsentActionResult> {
  await requireUser(defaultLocale);
  const parsed = consentEntriesSchema.safeParse(entries);
  if (!parsed.success) return { error: GENERIC_FAILURE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_kind", {
    p_consents: parsed.data,
  });
  if (error) return { error: describe(error.message) };
  redirect(`/${defaultLocale}/onboarding`);
}

// For an account that has no kind yet (a Google sign-up): the kind is chosen here, once, and committed with the consents.
export async function chooseAccountKind(
  kind: string,
  entries: ConsentEntry[],
): Promise<ConsentActionResult> {
  await requireUser(defaultLocale);
  const parsedKind = accountKindSchema.safeParse(kind);
  const parsedEntries = consentEntriesSchema.safeParse(entries);
  if (!parsedKind.success || !parsedEntries.success) return { error: GENERIC_FAILURE };

  const missing = unacceptedDocuments(await getSignupDocuments(parsedKind.data), parsedEntries.data);
  if (missing.length > 0) return { error: consentMessage(missing[0]) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("choose_account_kind", {
    p_kind: parsedKind.data,
    p_consents: parsedEntries.data,
  });
  if (error) return { error: describe(error.message) };
  redirect(`/${defaultLocale}/onboarding`);
}

export async function acceptReconsents(
  next: string,
  entries: ConsentEntry[],
): Promise<ConsentActionResult> {
  await requireUser(defaultLocale, { consentGate: false });
  const parsed = consentEntriesSchema.safeParse(entries);
  if (!parsed.success) return { error: GENERIC_FAILURE };

  const missing = unacceptedDocuments(await getPendingReconsents(), parsed.data);
  if (missing.length > 0) return { error: consentMessage(missing[0]) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_consents", {
    p_consents: parsed.data,
  });
  if (error) return { error: describe(error.message) };

  redirect(consentReturnPath(defaultLocale, next));
}
