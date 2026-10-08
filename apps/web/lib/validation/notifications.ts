import { z } from "zod";

const emailDeliveries = ["immediate", "daily_summary"] as const;

export type EmailDelivery = (typeof emailDeliveries)[number];

export const notificationSettingsSchema = z.strictObject({
  delivery: z.enum(emailDeliveries, { error: "Choose how to receive new-application emails" }),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
