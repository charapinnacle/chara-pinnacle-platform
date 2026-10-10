import * as z from "zod";

const emailDeliveries = ["immediate", "daily_summary"] as const;

export const DAILY_SUMMARY_TIME_TEXT = "08:00 Central European time";

export type EmailDelivery = (typeof emailDeliveries)[number];

export const notificationSettingsSchema = z.strictObject({
  delivery: z.enum(emailDeliveries, { error: "Choose how to receive new-application emails" }),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
