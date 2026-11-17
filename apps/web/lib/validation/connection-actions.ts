import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { CONTROL_CHARACTER, LINE_BREAKS_AND_TABS, NO_CONTROL_CHARACTERS } from "@/lib/validation/job";
import { parseDate, todayUtc } from "@/lib/validation/passport";

// The defaults of the settings inquiry_body_min_chars and inquiry_body_max_chars, and the bounds of request_workforce
// (FR-P2 Data and validation). The database stays the authority.
export const INQUIRY_MIN = 20;
export const INQUIRY_MAX = 2_000;
export const NOTE_MAX = 2_000;
export const QUANTITY_MAX = 10_000;
const CITY_MAX = 100;

const normalized = z.string().transform((value) => value.replace(/\r\n?/g, "\n").trim());
const noControl = (value: string) => !CONTROL_CHARACTER.test(value.replace(LINE_BREAKS_AND_TABS, ""));

export const inquiryFormSchema = z.object({
  body: normalized
    .refine((value) => characters(value) >= INQUIRY_MIN, {
      error: `Write at least ${formatCount(INQUIRY_MIN)} characters, so the partner knows what you need.`,
    })
    .refine((value) => characters(value) <= INQUIRY_MAX, { error: `An inquiry has at most ${formatCount(INQUIRY_MAX)} characters.` })
    .refine(noControl, { error: NO_CONTROL_CHARACTERS }),
});

export type InquiryFormInput = z.input<typeof inquiryFormSchema>;
export type InquiryFormOutput = z.output<typeof inquiryFormSchema>;

const noteSchema = normalized
  .refine((value) => characters(value) <= NOTE_MAX, { error: `A message has at most ${formatCount(NOTE_MAX)} characters.` })
  .refine(noControl, { error: NO_CONTROL_CHARACTERS });

// The fields of request_workforce: one occupation, how many workers (1 to 10,000), where and from when (today in UTC or
// later), and an optional message. Numbers stay strings so the form can use the schema as its resolver.
export function workforceRequestFormSchema(today: string = todayUtc()) {
  return z.object({
    occupation: z.string().trim().regex(/^\d{4}$/, { error: "Select an occupation from the list." }),
    quantity: z
      .string()
      .trim()
      .refine((value) => /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= QUANTITY_MAX, {
        error: `Enter a number of workers from 1 to ${formatCount(QUANTITY_MAX)}.`,
      }),
    destination: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a country from the list." }),
    cityRegion: z
      .string()
      .trim()
      .min(1, { error: "Enter the city or region." })
      .max(CITY_MAX, { error: `A city or region has at most ${formatCount(CITY_MAX)} characters.` })
      .refine((value) => !CONTROL_CHARACTER.test(value), { error: NO_CONTROL_CHARACTERS }),
    startDate: z
      .string()
      .trim()
      .superRefine((value, context) => {
        const message =
          value === "" ? "Enter the start date." : parseDate(value) === null ? "Choose a valid date." : value < today ? "The start date cannot be in the past." : null;
        if (message) context.addIssue({ code: "custom", message });
      }),
    body: noteSchema,
  });
}

export type WorkforceRequestFormInput = z.input<ReturnType<typeof workforceRequestFormSchema>>;
export type WorkforceRequestFormOutput = z.output<ReturnType<typeof workforceRequestFormSchema>>;

export const jobInvitationFormSchema = z.object({
  jobId: z.uuid({ error: "Select a vacancy." }),
  body: noteSchema,
});

export type JobInvitationFormInput = z.input<typeof jobInvitationFormSchema>;
export type JobInvitationFormOutput = z.output<typeof jobInvitationFormSchema>;
