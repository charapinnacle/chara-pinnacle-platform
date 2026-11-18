import * as z from "zod";
import { staffReasonSchema } from "@/lib/validation/admin";

// The retention editor (FR-S3 AC10, NFR-O5). The bounds mirror admin_set_retention_policy, which checks them again: a
// period of 1 to 3,650 days and a reason of 10 to 500 characters.

export const RETENTION_DAYS_MIN = 1;
export const RETENTION_DAYS_MAX = 3650;

export type RetentionPolicy = {
  entity: string;
  label: string;
  description: string;
  days: number;
  editable: boolean;
};

const DAYS_MESSAGE = `Enter a whole number of days from ${RETENTION_DAYS_MIN} to ${RETENTION_DAYS_MAX.toLocaleString("en-GB")}.`;

const daysSchema = z
  .string({ error: DAYS_MESSAGE })
  .trim()
  .regex(/^\d{1,9}$/, DAYS_MESSAGE)
  .refine((value) => Number(value) >= RETENTION_DAYS_MIN && Number(value) <= RETENTION_DAYS_MAX, DAYS_MESSAGE);

export const retentionFormSchema = z.object({ days: daysSchema, reason: staffReasonSchema });

export type RetentionForm = z.input<typeof retentionFormSchema>;

export const retentionInputSchema = z.object({
  entity: z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/).max(64),
  days: z.number().int().min(RETENTION_DAYS_MIN).max(RETENTION_DAYS_MAX),
  reason: staffReasonSchema,
});

export type RetentionInput = z.input<typeof retentionInputSchema>;

// A period in days and in months of an average Gregorian year (365.25 / 12 days), to one decimal: 730 days is 24 months.
export function monthsText(days: number): string {
  if (days < 30) return "less than 1 month";
  const months = Math.round((days / 30.4375) * 10) / 10;
  const value = Number.isInteger(months) ? String(months) : months.toFixed(1);
  return `${value} ${months === 1 ? "month" : "months"}`;
}

export function periodText(days: number): string {
  return `${days.toLocaleString("en-GB")} ${days === 1 ? "day" : "days"} (${monthsText(days)})`;
}
