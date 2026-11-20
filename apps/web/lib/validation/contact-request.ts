import * as z from "zod";
import { CONTACT_MESSAGE_MAX } from "@/lib/contact-requests/presentation";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { CONTROL_CHARACTER, LINE_BREAKS_AND_TABS, NO_CONTROL_CHARACTERS } from "@/lib/validation/job";

export const CONTACT_MESSAGE_REQUIRED = "Write a short message to the worker.";
export const CONTACT_MESSAGE_TOO_LONG = `A message has at most ${formatCount(CONTACT_MESSAGE_MAX)} characters.`;

// The rule of send_contact_request (FR-Q3 AC2): CR LF taken as a line feed, trimmed, 1 to 1,000 characters, no control
// character but line feed and tab; the vacancy is optional. The database stays the authority.
export const contactRequestFormSchema = z.object({
  message: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .refine((value) => value.length > 0, { error: CONTACT_MESSAGE_REQUIRED })
    .refine((value) => characters(value) <= CONTACT_MESSAGE_MAX, { error: CONTACT_MESSAGE_TOO_LONG })
    .refine((value) => !CONTROL_CHARACTER.test(value.replace(LINE_BREAKS_AND_TABS, "")), { error: NO_CONTROL_CHARACTERS }),
  jobId: z.union([z.literal(""), z.uuid()]),
});

export type ContactRequestFormInput = z.input<typeof contactRequestFormSchema>;
export type ContactRequestFormOutput = z.output<typeof contactRequestFormSchema>;

export const contactDecisionSchema = z.enum(["accept", "decline"]);
export type ContactDecision = z.infer<typeof contactDecisionSchema>;
