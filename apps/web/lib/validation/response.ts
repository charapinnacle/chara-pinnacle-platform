import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import { documentsLimitText, feeModels, hasAmount, hasCurrency } from "@/lib/responses/presentation";
import { characters } from "@/lib/utils";
import { CONTROL_CHARACTER, LINE_BREAKS_AND_TABS, NO_CONTROL_CHARACTERS } from "@/lib/validation/job";
import { dateWithin, parseDate, todayUtc } from "@/lib/validation/passport";

type RespondArgs = Database["public"]["Functions"]["respond_to_invitation"]["Args"];

// The arguments the form decides, the same for respond_to_invitation and update_response. The partner comes from the
// address and the requirement or response from the page; status, version and organization_id are no arguments of either
// function, so the mapper cannot carry them (FR-O2 AC2).
export type ResponseArgs = Omit<RespondArgs, "p_org" | "p_requirement">;

// The bounds of private.response_proposal and of the check partner_responses_fee; the database stays the authority.
export const TIMELINE_MAX = 1_000;
export const EXPERIENCE_MIN = 20;
export const EXPERIENCE_MAX = 4_000;
export const NOTES_MAX = 2_000;
export const WITHDRAWAL_REASON_MAX = 500;
const AVAILABLE_MONTHS_AHEAD = 36;
const AMOUNT_MAX = 9_999_999.99;
const PERCENT_MAX = 100;

export const CAPACITY_REQUIRED = "Enter the number of workers you can supply.";
export const CAPACITY_WHOLE = "Enter a whole number of at least 1.";

export function capacityAboveText(max: number): string {
  return `You can offer at most ${formatCount(max)} ${max === 1 ? "worker" : "workers"}.`;
}

export const AVAILABLE_FROM_REQUIRED = "Enter the date from which you can supply workers.";
export const AVAILABLE_FROM_PAST = "The date cannot be in the past.";
export const AVAILABLE_FROM_LATE = "Choose a date within the next 3 years.";
export const EXPERIENCE_TEXT = `Describe your relevant experience in ${formatCount(EXPERIENCE_MIN)} to ${formatCount(EXPERIENCE_MAX)} characters.`;
export const FEE_MODEL_REQUIRED = "Choose a fee model.";
export const AMOUNT_REQUIRED = "Enter the amount.";
export const AMOUNT_FORMAT = "Enter an amount above 0 with at most 2 decimals, for example 1500 or 1500.50.";
export const AMOUNT_TOO_HIGH = "The amount cannot be more than 9,999,999.99.";
export const PERCENT_RANGE = "Enter a percentage above 0 and at most 100, for example 12.5.";
export const CURRENCY_REQUIRED = "Select a currency from the list.";

function noControlCharacters(value: string): boolean {
  return !CONTROL_CHARACTER.test(value.replace(LINE_BREAKS_AND_TABS, ""));
}

function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .refine((value) => characters(value) <= max, { error: `The ${label} must have ${formatCount(max)} characters or fewer.` })
    .refine(noControlCharacters, { error: NO_CONTROL_CHARACTERS });
}

// The values the form keeps of the response it edits: update_response keeps an unchanged capacity above today's maximum
// and an unchanged date in the past, so the form does too.
export type KeptValues = { capacity: number; availableFrom: string };

type SchemaOptions = { maxCapacity: number; today?: string; kept?: KeptValues };

// The form's own schema (FR-O2 AC2): numbers stay strings so that the form can use it as its resolver; toResponseArgs
// converts them. Keys the form does not own, such as status, version or organization_id, are dropped by the parse. today
// is the UTC date available_from is compared with, as private.response_proposal compares it.
export function responseFormSchema({ maxCapacity, today = todayUtc(), kept }: SchemaOptions) {
  return z
    .object({
      capacity: z
        .string({ error: CAPACITY_REQUIRED })
        .trim()
        .min(1, { error: CAPACITY_REQUIRED, abort: true })
        .regex(/^\d+$/, { error: CAPACITY_WHOLE, abort: true })
        .refine((value) => Number(value) >= 1, { error: CAPACITY_WHOLE, abort: true })
        .refine((value) => Number(value) <= maxCapacity || Number(value) === kept?.capacity, { error: capacityAboveText(maxCapacity) }),
      availableFrom: z
        .string({ error: AVAILABLE_FROM_REQUIRED })
        .trim()
        .superRefine((value, context) => {
          if (value !== "" && value === kept?.availableFrom) return;
          const message =
            value === ""
              ? AVAILABLE_FROM_REQUIRED
              : parseDate(value) === null
                ? "Choose a valid date."
                : value < today
                  ? AVAILABLE_FROM_PAST
                  : !dateWithin(value, today, AVAILABLE_MONTHS_AHEAD)
                    ? AVAILABLE_FROM_LATE
                    : null;
          if (message) context.addIssue({ code: "custom", message });
        }),
      timelineNote: optionalText(TIMELINE_MAX, "timeline"),
      experienceNote: z
        .string({ error: EXPERIENCE_TEXT })
        .trim()
        .refine((value) => characters(value) >= EXPERIENCE_MIN && characters(value) <= EXPERIENCE_MAX, { error: EXPERIENCE_TEXT })
        .refine(noControlCharacters, { error: NO_CONTROL_CHARACTERS }),
      feeModel: z.string({ error: FEE_MODEL_REQUIRED }).pipe(z.enum(feeModels, { error: FEE_MODEL_REQUIRED })),
      feeAmount: z.string().trim(),
      feeCurrency: z.string().trim().toUpperCase(),
      notes: optionalText(NOTES_MAX, "notes"),
    })
    .check((context) => {
      const value = context.value;
      const issue = (path: string, message: string) => context.issues.push({ code: "custom", input: value, path: [path], message });
      if (hasAmount(value.feeModel)) {
        const amount = value.feeAmount;
        const percent = value.feeModel === "percent_first_year_salary";
        if (amount === "") issue("feeAmount", AMOUNT_REQUIRED);
        else if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) issue("feeAmount", percent ? PERCENT_RANGE : AMOUNT_FORMAT);
        else if (percent && Number(amount) > PERCENT_MAX) issue("feeAmount", PERCENT_RANGE);
        else if (!percent && Number(amount) > AMOUNT_MAX) issue("feeAmount", AMOUNT_TOO_HIGH);
      }
      if (hasCurrency(value.feeModel) && !/^[A-Z]{3}$/.test(value.feeCurrency)) issue("feeCurrency", CURRENCY_REQUIRED);
    });
}

export type ResponseFormInput = z.input<ReturnType<typeof responseFormSchema>>;
export type ResponseFormValues = z.output<ReturnType<typeof responseFormSchema>>;

export const emptyResponseForm: ResponseFormInput = {
  capacity: "",
  availableFrom: "",
  timelineNote: "",
  experienceNote: "",
  feeModel: "",
  feeAmount: "",
  feeCurrency: "",
  notes: "",
};

// The amount only for a fee model that has one, the currency only for one priced in a currency: a value left in a
// field the form hid is not sent. An empty optional text is left out, which the functions store as null.
export function toResponseArgs(values: ResponseFormValues): ResponseArgs {
  return {
    p_capacity: Number(values.capacity),
    p_available_from: values.availableFrom,
    p_experience_note: values.experienceNote,
    p_fee_model: values.feeModel,
    p_fee_amount: hasAmount(values.feeModel) ? Number(values.feeAmount) : undefined,
    p_fee_currency: hasCurrency(values.feeModel) ? values.feeCurrency : undefined,
    p_timeline_note: values.timelineNote === "" ? undefined : values.timelineNote,
    p_notes: values.notes === "" ? undefined : values.notes,
  };
}

// The withdrawal of FR-N2 AC8: an optional reason the employer reads, trimmed, up to 500 characters.
export const withdrawFormSchema = z.object({
  reason: optionalText(WITHDRAWAL_REASON_MAX, "reason"),
});

export type WithdrawFormInput = z.input<typeof withdrawFormSchema>;
export type WithdrawFormOutput = z.output<typeof withdrawFormSchema>;

// The capacity tolerance of a requirement (FR-O2 AC4): a whole per cent from 0 to 100.
export const toleranceFormSchema = z.object({
  percent: z
    .string()
    .trim()
    .refine((value) => /^\d{1,3}$/.test(value) && Number(value) <= 100, { error: "Enter a whole number from 0 to 100." }),
});

export type ToleranceFormInput = z.input<typeof toleranceFormSchema>;

// The checks of register_response_document before an upload URL is asked for (FR-O2 AC5): a PDF of 1 byte to 15 MB whose
// name is 5 to 120 characters ending in .pdf, and room left under the documents limit. The scan checks the content.
export const DOCUMENT_SIZE_MAX = 15 * 1024 * 1024;
export const DOCUMENT_NAME_MAX = 120;
export const DOCUMENT_TYPE = "application/pdf";
export const DOCUMENT_TOO_LARGE = "Choose a PDF file of up to 15 MB.";
export const DOCUMENT_NOT_PDF = "Choose a PDF file.";
export const DOCUMENT_NAME = "Rename the file to between 5 and 120 characters ending in .pdf, without slashes.";

export type DocumentFile = { name: string; size: number; type: string };

export function documentFileIssue(file: DocumentFile, attached: number, max: number): string | null {
  if (attached >= max) return `${documentsLimitText(max)}.`;
  if (file.type !== DOCUMENT_TYPE || !/\.pdf$/i.test(file.name)) return DOCUMENT_NOT_PDF;
  if (file.size < 1 || file.size > DOCUMENT_SIZE_MAX) return DOCUMENT_TOO_LARGE;
  const name = file.name.trim();
  if (characters(name) < 5 || characters(name) > DOCUMENT_NAME_MAX || /[\\/]/.test(name) || CONTROL_CHARACTER.test(name)) {
    return DOCUMENT_NAME;
  }
  return null;
}

// The note of a decision (FR-O3 AC5): optional, trimmed, up to 1,000 characters; the partner of that response reads it.
export const DECISION_NOTE_MAX = 1_000;

export const decisionFormSchema = z.object({
  note: optionalText(DECISION_NOTE_MAX, "note"),
});

export type DecisionFormInput = z.input<typeof decisionFormSchema>;
export type DecisionFormOutput = z.output<typeof decisionFormSchema>;
