"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import {
  grantFormSchema,
  legalDocumentSchema,
  mfaResetFormSchema,
  revokeInputSchema,
  type GrantForm,
  type LegalDocumentForm,
  type MfaResetForm,
} from "@/lib/validation/admin";
import { fieldErrors } from "@/lib/validation/sign-up";

const REASON = { "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 500 characters" } } };

export async function grantRole(input: GrantForm): Promise<AdminResult> {
  const parsed = grantFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const { email, role, reason } = parsed.data;
  const path = adminPath(defaultLocale, "staff");
  const supabase = await adminClient();

  const found = await supabase.rpc("admin_search_users", { p_term: email, p_limit: 5 });
  if (found.error) return adminRefusal(found.error, path);
  const person = found.data.find((row) => row.email.toLowerCase() === email);
  if (!person) return { errors: { email: "No account has this email address" } };

  const { error } = await supabase.rpc("grant_platform_role", { p_user_id: person.id, p_role: role, p_reason: reason });
  if (error) {
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_FORBIDDEN:own_account": { errors: { email: "You cannot give a role to yourself" } },
      CHARA_CONFLICT: { errors: { role: "This person already has this role" } },
      "CHARA_INVALID_INPUT:user": { errors: { email: "This person has no active account with a confirmed email address" } },
    });
  }
  revalidatePath(path);
  return { done: true };
}

export async function revokeRole(input: { userId: string; role: string; reason: string }): Promise<AdminResult> {
  const parsed = revokeInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const path = adminPath(defaultLocale, "staff");
  const { error } = await (await adminClient()).rpc("revoke_platform_role", {
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
    p_reason: parsed.data.reason,
  });
  if (error) {
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_FORBIDDEN:last_administrator": { message: "The last administrator cannot be revoked." },
      CHARA_CONFLICT: { message: "This role was already revoked." },
      "CHARA_INVALID_INPUT:role": { message: "This person does not hold this role." },
    });
  }
  revalidatePath(path);
  return { done: true };
}

export async function resetMfa(input: MfaResetForm): Promise<AdminResult> {
  const parsed = mfaResetFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const { userId, reason } = parsed.data;
  const { error } = await (await adminClient()).rpc("reset_mfa", { p_user_id: userId, p_reason: reason });
  if (error) {
    return adminRefusal(error, adminPath(defaultLocale, "mfa-reset"), {
      ...REASON,
      "CHARA_FORBIDDEN:own_account": { message: "You cannot reset your own two-step verification." },
      "CHARA_INVALID_INPUT:user": { errors: { userId: "No account has this user id" } },
    });
  }
  return { done: true };
}

export async function publishLegalDocument(input: LegalDocumentForm): Promise<AdminResult & { version?: number }> {
  const parsed = legalDocumentSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const { slug, title, body, changeSummary, isDraft } = parsed.data;
  const path = adminPath(defaultLocale, "legal");
  const { data, error } = await (await adminClient()).rpc("publish_legal_document", {
    p_slug: slug,
    p_title: title,
    p_body: body,
    p_change_summary: changeSummary,
    p_is_draft: isDraft,
  });
  if (error) {
    return adminRefusal(error, path, {
      "CHARA_INVALID_INPUT:slug": { errors: { slug: "This is not a valid document name" } },
      "CHARA_INVALID_INPUT:title": { errors: { title: "Enter a title of 3 to 200 characters" } },
      "CHARA_INVALID_INPUT:body": { errors: { body: "Enter the text of the document" } },
      "CHARA_INVALID_INPUT:change_summary": { errors: { changeSummary: "Describe the change in 10 to 1000 characters" } },
      CHARA_CONFLICT: { message: "This text is already the current version of the document." },
    });
  }
  revalidatePath(path);
  return { done: true, version: data };
}
