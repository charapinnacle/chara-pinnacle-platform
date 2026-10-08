import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { emailSchema } from "@/lib/validation/sign-up";

export type PlatformRole = Database["public"]["Enums"]["platform_role"];

export const ADMIN_PAGE_SIZE = 25;

export const platformRoleSchema = z.enum(["admin", "verification_reviewer", "trust_safety"] as const satisfies readonly PlatformRole[], {
  error: "Choose a role",
});

export const platformRoleLabels = {
  admin: "Platform Administrator",
  verification_reviewer: "Verification Reviewer",
  trust_safety: "Trust & Safety Administrator",
} as const satisfies Record<PlatformRole, string>;

export const searchTermSchema = z
  .string()
  .trim()
  .min(3, "Enter at least 3 characters")
  .max(100, "Use at most 100 characters");

export const searchFormSchema = z.object({ term: searchTermSchema });

export type SearchForm = z.input<typeof searchFormSchema>;

export const nameCursorSchema = z.object({ name: z.string().max(200), id: z.uuid() }).nullable();

export type NameCursor = z.infer<typeof nameCursorSchema>;

export const timeCursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.number().int().positive() }).nullable();

export type TimeCursor = z.infer<typeof timeCursorSchema>;

// The statement of reasons of a suspension or a reinstatement; the staff actions of FR-A7 keep their shorter limit.
export const statementSchema = z
  .string({ error: "Enter the reason" })
  .trim()
  .min(10, "Give a reason of at least 10 characters")
  .max(2000, "The reason can have at most 2000 characters");

export const staffReasonSchema = z
  .string({ error: "Enter the reason" })
  .trim()
  .min(10, "Give a reason of at least 10 characters")
  .max(500, "The reason can have at most 500 characters");

export const moderationFormSchema = z.object({ reason: statementSchema });

export type ModerationForm = z.input<typeof moderationFormSchema>;

export const moderationTargetSchema = z.enum(["user", "organization"]);

export const moderationInputSchema = moderationFormSchema.extend({
  target: moderationTargetSchema,
  id: z.uuid(),
  to: z.enum(["suspended", "active"]),
});

const userIdSchema = z.uuid({ error: "Enter a valid user id" });

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return dayPattern.test(value) && !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

const dayField = z.string().trim().refine((value) => value === "" || isDay(value), "Enter a date as year-month-day");

export const auditFilterSchema = z
  .object({
    actor: z.string().trim().refine((value) => value === "" || userIdSchema.safeParse(value).success, "Enter a valid user id"),
    action: z.string().trim().max(100, "Use at most 100 characters"),
    entityType: z.string().trim().max(100, "Use at most 100 characters"),
    entityId: z.string().trim().max(200, "Use at most 200 characters"),
    from: dayField,
    to: dayField,
  })
  .refine((value) => value.from === "" || value.to === "" || value.from <= value.to, {
    path: ["from"],
    error: "The start date must not be after the end date",
  });

export type AuditFilterForm = z.input<typeof auditFilterSchema>;
export type AuditFilter = z.output<typeof auditFilterSchema>;

export const MAX_RANGE_DAYS = 366;

export const rangeSchema = z
  .object({ from: z.string().refine(isDay, "Enter a date as year-month-day"), to: z.string().refine(isDay, "Enter a date as year-month-day") })
  .superRefine((value, ctx) => {
    const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 + 1;
    if (days < 1) ctx.addIssue({ code: "custom", path: ["from"], message: "The start date must not be after the end date" });
    else if (days > MAX_RANGE_DAYS) ctx.addIssue({ code: "custom", path: ["to"], message: `Choose at most ${MAX_RANGE_DAYS} days` });
  });

export const legalDocumentSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, digits and single hyphens")
    .min(3, "Use at least 3 characters")
    .max(60, "Use at most 60 characters"),
  title: z.string().trim().min(3, "Enter a title of 3 to 200 characters").max(200, "Enter a title of 3 to 200 characters"),
  body: z.string().refine((value) => value.trim() !== "", "Enter the text of the document").refine((value) => value.length <= 200_000, "The text can have at most 200,000 characters"),
  changeSummary: z.string().trim().min(10, "Describe the change in 10 to 1000 characters").max(1000, "Describe the change in 10 to 1000 characters"),
});

export type LegalDocumentForm = z.input<typeof legalDocumentSchema>;

export const grantFormSchema = z.object({
  email: emailSchema,
  role: z.string().pipe(platformRoleSchema),
  reason: staffReasonSchema,
});

export type GrantForm = z.input<typeof grantFormSchema>;
export type GrantOutput = z.output<typeof grantFormSchema>;

export const revokeFormSchema = z.object({ reason: staffReasonSchema });

export const revokeInputSchema = revokeFormSchema.extend({ userId: z.uuid(), role: platformRoleSchema });

export const mfaResetFormSchema = z.object({
  userId: userIdSchema,
  identityChecked: z.boolean().refine((checked) => checked, "Confirm that you verified this person's identity"),
  reason: staffReasonSchema,
});

export type MfaResetForm = z.input<typeof mfaResetFormSchema>;
