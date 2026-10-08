"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { saveEmailDelivery } from "@/lib/dal/notifications";
import { defaultLocale } from "@/lib/i18n/locale";
import { notificationSettingsPath } from "@/lib/routes";
import { notificationSettingsSchema, type NotificationSettings } from "@/lib/validation/notifications";
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
