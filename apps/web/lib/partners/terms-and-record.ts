import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import { feeModelsByKind, feeText, hasAmount, hasCurrency, type FeeModel, type PartnerKind } from "@/lib/responses/presentation";
import {
  AMOUNT_FORMAT,
  AMOUNT_REQUIRED,
  AMOUNT_TOO_HIGH,
  CURRENCY_REQUIRED,
  FEE_MODEL_FOR_KIND,
  FEE_MODEL_REQUIRED,
  PERCENT_RANGE,
} from "@/lib/validation/response";

// A partner's standard terms and track record (public.partner_standard_terms, public.partner_track_records): the fee
// follows the rules of a response for the partner's kind, and every number is optional except the fee model.

export const TERMS_NOTE_MAX = 300;
export const PLACEMENTS_MAX = 1_000_000;
export const COUNTRIES_PLACED_MAX = 50;

const wholeUpTo = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max), { error: message });

export function standardTermsSchema(kind: PartnerKind) {
  return z
    .object({
      feeModel: z.string({ error: FEE_MODEL_REQUIRED }).refine((value) => (feeModelsByKind[kind] as readonly string[]).includes(value), {
        error: FEE_MODEL_FOR_KIND,
      }),
      feeAmount: z.string().trim(),
      feeCurrency: z.string().trim().toUpperCase(),
      guaranteeDays: wholeUpTo(0, 365, "Enter a number of days from 0 to 365."),
      minAssignmentWeeks: wholeUpTo(1, 260, "Enter a number of weeks from 1 to 260."),
      note: z
        .string()
        .trim()
        .max(TERMS_NOTE_MAX, {
          error: `Write at most ${formatCount(TERMS_NOTE_MAX)} characters.`,
        })
        .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
          error: "Remove line breaks and special characters.",
        }),
    })
    .check((context) => {
      const value = context.value;
      const issue = (path: string, message: string) =>
        context.issues.push({
          code: "custom",
          input: value,
          path: [path],
          message,
        });
      const model = value.feeModel as FeeModel;
      if (hasAmount(model)) {
        const percent = model === "percent_first_year_salary";
        if (value.feeAmount === "") issue("feeAmount", AMOUNT_REQUIRED);
        else if (!/^\d+(\.\d{1,2})?$/.test(value.feeAmount) || Number(value.feeAmount) <= 0)
          issue("feeAmount", percent ? PERCENT_RANGE : AMOUNT_FORMAT);
        else if (percent && Number(value.feeAmount) > 100) issue("feeAmount", PERCENT_RANGE);
        else if (!percent && Number(value.feeAmount) > 9_999_999.99) issue("feeAmount", AMOUNT_TOO_HIGH);
      }
      if (hasCurrency(model) && !/^[A-Z]{3}$/.test(value.feeCurrency)) issue("feeCurrency", CURRENCY_REQUIRED);
    });
}

export type StandardTermsInput = z.input<ReturnType<typeof standardTermsSchema>>;

export const trackRecordSchema = z.object({
  placementsLastYear: wholeUpTo(0, PLACEMENTS_MAX, `Enter a whole number from 0 to ${formatCount(PLACEMENTS_MAX)}.`),
  countriesPlaced: z.array(z.string().regex(/^[A-Z]{2}$/)).max(COUNTRIES_PLACED_MAX, {
    error: `Choose at most ${formatCount(COUNTRIES_PLACED_MAX)} countries.`,
  }),
});

export type TrackRecordInput = z.input<typeof trackRecordSchema>;

export type StandardTerms = {
  feeModel: FeeModel;
  feeAmount: number | null;
  feeCurrency: string | null;
  guaranteeDays: number | null;
  minAssignmentWeeks: number | null;
  note: string | null;
};

export type TrackRecord = {
  placementsLastYear: number | null;
  countriesPlaced: { code: string; name: string }[];
  platformHires: number;
};

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

// The terms as lines of the public profile: the fee, then the guarantee or the shortest assignment, then the note.
export function standardTermsLines(terms: StandardTerms): string[] {
  const lines = [feeText(terms.feeModel, terms.feeAmount, terms.feeCurrency)];
  if (terms.guaranteeDays !== null) {
    lines.push(
      terms.guaranteeDays === 0 ? "No replacement guarantee" : `Free replacement within ${plural(terms.guaranteeDays, "day", "days")}`,
    );
  }
  if (terms.minAssignmentWeeks !== null) lines.push(`Shortest assignment ${plural(terms.minAssignmentWeeks, "week", "weeks")}`);
  if (terms.note) lines.push(terms.note);
  return lines;
}

// What the company states of its record; the hires counted on the platform are shown apart from them, and the years in
// business are in the overview ("Operating since").
export function trackRecordLines(record: TrackRecord): string[] {
  const lines: string[] = [];
  if (record.placementsLastYear !== null)
    lines.push(`${plural(record.placementsLastYear, "worker", "workers")} placed in the last 12 months`);
  if (record.countriesPlaced.length > 0) lines.push(`Placed in ${record.countriesPlaced.map((country) => country.name).join(", ")}`);
  return lines;
}
