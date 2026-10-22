"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import {
  getUnreadNotificationCount,
  markNotificationsRead as markRead,
  saveEmailDelivery,
  saveEmailKinds,
} from "@/lib/dal/notifications";
import { defaultLocale } from "@/lib/i18n/locale";
import { notificationSettingsPath, notificationsPath } from "@/lib/routes";
import {
  emailKindsSchema,
  markReadSchema,
  notificationSettingsSchema,
  type EmailKinds,
  type NotificationSettings,
} from "@/lib/validation/notifications";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type SaveResult = { errors?: FieldErrors; message?: string; done?: true };

export async function saveNotificationSettings(input: NotificationSettings): Promise<SaveResult> {
  const parsed = notificationSettingsSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const error = await saveEmailDelivery(parsed.data.delivery);
  if (error?.message === "CHARA_FORBIDDEN") {
    return { message: "Only employer accounts can choose how new-application emails are sent." };
  }
  if (error) {
    console.error("Saving the notification settings failed", { code: error.code, message: error.message });
    return { message: GENERIC_FAILURE };
  }
  revalidatePath(notificationSettingsPath(defaultLocale));
  return { done: true };
}

export async function saveEmailKindSettings(input: EmailKinds): Promise<SaveResult> {
  const parsed = emailKindsSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const error = await saveEmailKinds(parsed.data.kinds);
  if (error?.details === "mandatory_kind") return { message: "Emails that are always sent cannot be switched off." };
  if (error) {
    console.error("Saving the email choices failed", { code: error.code, message: error.message, details: error.details });
    return { message: GENERIC_FAILURE };
  }
  revalidatePath(notificationSettingsPath(defaultLocale));
  return { done: true };
}

// null marks every item read. The page is revalidated so that a return to it shows the items read.
export async function markNotificationsRead(ids: string[] | null): Promise<{ message?: string }> {
  const parsed = markReadSchema.safeParse(ids);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const error = await markRead(parsed.data);
  if (error) {
    console.error("Marking notifications read failed", { code: error.code, message: error.message });
    return { message: GENERIC_FAILURE };
  }
  revalidatePath(notificationsPath(defaultLocale));
  return {};
}

// The header bell asks this while the Realtime channel is not connected; null when the count cannot be read.
export async function fetchUnreadNotificationCount(): Promise<number | null> {
  try {
    return await getUnreadNotificationCount();
  } catch {
    return null;
  }
}
