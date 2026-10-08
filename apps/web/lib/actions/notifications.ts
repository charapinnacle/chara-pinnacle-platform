"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { saveEmailDelivery, type PreferenceRefusal } from "@/lib/dal/notifications";
import { defaultLocale } from "@/lib/i18n/locale";
import { notificationSettingsPath } from "@/lib/routes";
import { notificationSettingsSchema, type NotificationSettings } from "@/lib/validation/notifications";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type SaveResult = { errors?: FieldErrors; message?: string; done?: true };

const refusals: Record<PreferenceRefusal, string> = {
  forbidden: "Only employer accounts can choose how new-application emails are sent.",
  failed: GENERIC_FAILURE,
};

export async function saveNotificationSettings(input: NotificationSettings): Promise<SaveResult> {
  const parsed = notificationSettingsSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const refusal = await saveEmailDelivery(parsed.data.delivery);
  if (refusal) return { message: refusals[refusal] };
  revalidatePath(notificationSettingsPath(defaultLocale));
  return { done: true };
}
