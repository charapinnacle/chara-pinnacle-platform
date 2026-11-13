import * as z from "zod";

const emailDeliveries = ["immediate", "daily_summary"] as const;

export const DAILY_SUMMARY_TIME_TEXT = "08:00 Central European time";

export type EmailDelivery = (typeof emailDeliveries)[number];

export const notificationSettingsSchema = z.strictObject({
  delivery: z.enum(emailDeliveries, { error: "Choose how to receive new-application emails" }),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

// The email choice per optional kind, as the form holds it; which kinds may be chosen is the database's to decide.
export const emailKindsSchema = z.strictObject({
  kinds: z
    .record(z.string().regex(/^[a-z][a-z_]{1,62}$/), z.boolean())
    .refine((kinds) => Object.keys(kinds).length > 0, { error: "Choose at least one kind" }),
});

export type EmailKinds = z.infer<typeof emailKindsSchema>;

export const markReadSchema = z.array(z.uuid()).min(1).max(100).nullable();
