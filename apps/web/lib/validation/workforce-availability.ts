import * as z from "zod";
import { LEVEL_WITHOUT_LANGUAGE, skillFields } from "@/lib/workforce/skills";
import { formatCount } from "@/lib/i18n/format";
import { parseDate, todayUtc } from "@/lib/validation/passport";

// The same bounds as the workforce_availability checks and private.listing_available_from; the database stays the
// authority.
export const LISTING_MIN = 1;
export const LISTING_MAX = 100_000;
const DAY_MS = 86_400_000;

export {
  confirmedAgo,
  freshnessLabel,
  listingFreshness,
  type AvailabilityRules,
  type ListingFreshness,
} from "@/lib/workforce/freshness";

// What the form checks besides the values: the occupations and source countries of the partner's own profile and the
// date bound, both left to the database by the Server Action, and today (UTC).
export type ListingFormRules = {
  occupations?: readonly { code: string }[];
  countries?: readonly { code: string }[];
  maxDays?: number;
  today?: string;
};

function count(empty: string) {
  const range = `Enter a whole number from ${formatCount(LISTING_MIN)} to ${formatCount(LISTING_MAX)}.`;
  return z
    .string({ error: empty })
    .trim()
    .min(1, { error: empty, abort: true })
    .regex(/^\d+$/, { error: range, abort: true })
    .refine((value) => Number(value) >= LISTING_MIN && Number(value) <= LISTING_MAX, { error: range });
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function listingFormSchema(rules: ListingFormRules = {}) {
  const today = rules.today ?? todayUtc();
  return z
    .object({
      occupation: z
        .string({ error: "Choose an occupation." })
        .trim()
        .min(1, { error: "Choose an occupation.", abort: true })
        .refine((code) => !rules.occupations || rules.occupations.some((item) => item.code === code), {
          error: "Choose one of the occupations you offer.",
        }),
      country: z
        .string({ error: "Choose a source country." })
        .trim()
        .toUpperCase()
        .min(1, { error: "Choose a source country.", abort: true })
        .refine((code) => !rules.countries || rules.countries.some((item) => item.code === code), {
          error: "Choose one of the countries you source workers from.",
        }),
      available: count("Enter how many workers are available now."),
      monthlyCapacity: count("Enter how many workers you can supply each month."),
      availableFrom: z.string({ error: "Enter the date from which the workers are available." }).trim(),
      ...skillFields,
    })
    .check((context) => {
      const { availableFrom } = context.value;
      if (context.value.languageLevel !== "" && context.value.languageCode === "") {
        context.issues.push({ code: "custom", input: context.value.languageCode, path: ["languageCode"], message: LEVEL_WITHOUT_LANGUAGE });
      }
      const message =
        availableFrom === ""
          ? "Enter the date from which the workers are available."
          : parseDate(availableFrom) === null
            ? "Choose a valid date."
            : rules.maxDays !== undefined && availableFrom > addDays(today, rules.maxDays)
              ? `Choose a date up to ${formatCount(rules.maxDays)} days ahead.`
              : null;
      if (message) context.issues.push({ code: "custom", input: availableFrom, path: ["availableFrom"], message });
    });
}

export type ListingInput = z.input<ReturnType<typeof listingFormSchema>>;

export const listingIdSchema = z.uuid();

// The warning next to Save when a profile change removes codes that availability listings name: the listings go with
// them (the foreign keys cascade). Null when nothing with listings is removed.
export function listingRemovalWarning(
  saved: readonly string[],
  current: readonly string[],
  counts: Readonly<Record<string, number>>,
  nameOf: (code: string) => string,
): string | null {
  const removed = saved.filter((code) => !current.includes(code) && (counts[code] ?? 0) > 0);
  if (removed.length === 0) return null;
  const total = removed.reduce((sum, code) => sum + counts[code], 0);
  const names = removed.map(nameOf);
  const named = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Removing ${named} also deletes ${formatCount(total)} availability ${total === 1 ? "listing" : "listings"}.`;
}

// The listings confirmed longest ago first (they need the partner's attention), then by occupation and country.
export function sortListings<T extends { confirmedAt: string; occupation: string; country: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.confirmedAt.localeCompare(b.confirmedAt) || a.occupation.localeCompare(b.occupation) || a.country.localeCompare(b.country),
  );
}
