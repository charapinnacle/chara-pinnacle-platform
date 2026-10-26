import * as z from "zod";
import { countryInSentence } from "@/lib/i18n/format";
import { checkFile, acceptedExtensions } from "@/lib/validation/documents";
import type { LicenceStatus } from "@/lib/validation/licence-status";
import { dateWithin, parseDate, todayUtc } from "@/lib/validation/passport";

// The same bounds as the partner_licences constraints and check_licence_input; the database stays the authority.
const AUTHORITY_MIN = 2;
const AUTHORITY_MAX = 200;
const NUMBER_MIN = 3;
const NUMBER_MAX = 64;
const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export const LICENCE_STAFF_ONLY = "Seen only by Chara Pinnacle staff until verification is available";
export const evidenceAccept = acceptedExtensions;

// What the form needs to know besides the field values: the country list, the number formats per country and the date
// bound (public settings licence_number_patterns and licence_valid_until_max_years), today (UTC) and, when an entry is
// edited, its saved date, which the database does not check against the window again. The Server Action passes no date
// bound and leaves the window to the database, as for the other dated forms.
export type LicenceRules = {
  countries: readonly { code: string; name: string }[];
  patterns: Readonly<Record<string, string>>;
  maxYears?: number;
  today?: string;
  savedValidUntil?: string;
};

// A format that is not a valid regular expression here is left to the database, which checks it with its own engine.
function matchesFormat(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

function text(min: number, max: number, empty: string, length: string) {
  return z
    .string({ error: empty })
    .trim()
    .min(1, { error: empty, abort: true })
    .min(min, { error: length })
    .max(max, { error: length })
    .refine((value) => !CONTROL_CHARACTER.test(value), { error: "Use one line of plain text." });
}

export function licenceFormSchema(rules: LicenceRules) {
  const today = rules.today ?? todayUtc();
  const nameOf = (code: string) => rules.countries.find((country) => country.code === code)?.name;
  return z
    .object({
      country: z
        .string({ error: "Choose a country." })
        .trim()
        .toUpperCase()
        .refine((code) => nameOf(code) !== undefined, { error: "Choose a country from the list." }),
      issuingAuthority: text(
        AUTHORITY_MIN,
        AUTHORITY_MAX,
        "Enter the issuing authority.",
        `The issuing authority has ${AUTHORITY_MIN} to ${AUTHORITY_MAX} characters.`,
      ),
      licenceNumber: text(
        NUMBER_MIN,
        NUMBER_MAX,
        "Enter the licence or registration number.",
        `The number has ${NUMBER_MIN} to ${NUMBER_MAX} characters.`,
      ),
      validUntil: z.string({ error: "Enter the valid-until date." }).trim(),
      confirmed: z.boolean().refine((value) => value, { error: "Confirm that this entry is accurate." }),
    })
    .check((context) => {
      const { country, licenceNumber, validUntil } = context.value;
      const dateMessage =
        validUntil === ""
          ? "Enter the valid-until date."
          : parseDate(validUntil) === null
            ? "Choose a valid date."
            : rules.maxYears !== undefined &&
                validUntil !== rules.savedValidUntil &&
                !dateWithin(validUntil, today, rules.maxYears * 12)
              ? `Choose today or a later date, up to ${rules.maxYears} years ahead.`
              : null;
      if (dateMessage) context.issues.push({ code: "custom", input: validUntil, path: ["validUntil"], message: dateMessage });
      const pattern = rules.patterns[country];
      const name = nameOf(country);
      if (pattern && name && licenceNumber.length >= NUMBER_MIN && !matchesFormat(pattern, licenceNumber)) {
        context.issues.push({
          code: "custom",
          input: licenceNumber,
          path: ["licenceNumber"],
          message: `This does not match the usual format of licence numbers in ${countryInSentence(country, name)}`,
        });
      }
    });
}

export type LicenceInput = z.input<ReturnType<typeof licenceFormSchema>>;

// The optional evidence file: the form holds the File, the Server Action receives its size and type only.
export const evidenceFormSchema = z.union([z.undefined(), z.instanceof(File).check(checkFile)]);
export const evidenceFileSchema = z.object({ name: z.string(), size: z.number(), type: z.string() }).check(checkFile);
export type EvidenceFile = z.input<typeof evidenceFileSchema>;

export const licenceIdSchema = z.uuid();

// The number formats of the public setting licence_number_patterns: an object of country codes and patterns; anything
// else counts as no format.
const patternsSchema = z.record(z.string().regex(/^[A-Z]{2}$/), z.string());

export function parseLicencePatterns(value: string | undefined): Record<string, string> {
  let json: unknown;
  try {
    json = JSON.parse(value ?? "{}");
  } catch {
    return {};
  }
  const parsed = patternsSchema.safeParse(json);
  return parsed.success ? parsed.data : {};
}

export { evidenceStatusLabels, type EvidenceStatus, type LicenceStatus } from "@/lib/validation/licence-status";

// Expired entries first (they need the partner's attention), then by valid-until date and country.
export function sortLicences<T extends { status: LicenceStatus; validUntil: string; country: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.status === "expired") - Number(a.status === "expired") ||
      a.validUntil.localeCompare(b.validUntil) ||
      a.country.localeCompare(b.country),
  );
}
