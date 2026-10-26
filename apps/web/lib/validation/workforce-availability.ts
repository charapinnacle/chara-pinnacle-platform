import * as z from "zod";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { parseDate, todayUtc } from "@/lib/validation/passport";

// The same bounds as the workforce_availability checks and private.listing_available_from; the database stays the
// authority.
export const LISTING_MIN = 1;
export const LISTING_MAX = 100_000;
const DAY_MS = 86_400_000;

// The periods of the public settings workforce_listing_stale_days, workforce_confirm_reminder_days and
// workforce_available_from_max_days.
export type AvailabilityRules = { staleDays: number; reminderDays: number; maxDays: number };

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
    })
    .check((context) => {
      const { availableFrom } = context.value;
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

export type ListingFreshness =
  | { state: "fresh"; ageDays: number }
  | { state: "due"; ageDays: number; daysLeft: number }
  | { state: "hidden"; ageDays: number };

// Where a listing stands: fresh, due for confirmation once it is reminderDays old (the reminder job uses the same
// period), hidden from everyone outside the partner once it is staleDays old, as the read policy decides.
export function listingFreshness(confirmedAt: string, now: Date, rules: AvailabilityRules): ListingFreshness {
  const ageDays = Math.max(0, Math.floor((now.getTime() - Date.parse(confirmedAt)) / DAY_MS));
  if (ageDays >= rules.staleDays) return { state: "hidden", ageDays };
  if (ageDays >= rules.reminderDays) return { state: "due", ageDays, daysLeft: rules.staleDays - ageDays };
  return { state: "fresh", ageDays };
}

const days = (n: number) => `${formatCount(n)} ${n === 1 ? "day" : "days"}`;

// The days between the UTC calendar dates of the confirmation and now: a confirmation at 23:50 is "yesterday" ten minutes
// later, although less than a day has passed (ageDays, which decides the state, counts whole days).
function calendarDaysBetween(confirmedAt: string, now: Date): number {
  const day = (time: number) => Math.floor(time / DAY_MS);
  return Math.max(0, day(now.getTime()) - day(Date.parse(confirmedAt)));
}

function confirmedAgo(confirmedAt: string, now: Date): string {
  const daysAgo = calendarDaysBetween(confirmedAt, now);
  if (daysAgo === 0) return "Confirmed today.";
  return `Confirmed ${daysAgo === 1 ? "yesterday" : `${days(daysAgo)} ago`}, on ${formatDate(confirmedAt)}.`;
}

// The words of the list: the badge of a listing hidden from search and the sentence that always says when it was last
// confirmed, with what to do when it needs confirming (FR-K3 AC1, AC6, AC10).
export function freshnessLabel(
  freshness: ListingFreshness,
  confirmedAt: string,
  now: Date,
): { badge: string | null; text: string } {
  const ago = confirmedAgo(confirmedAt, now);
  if (freshness.state === "hidden") return { badge: "Hidden from search", text: `${ago} Confirm to show it again.` };
  if (freshness.state === "due") {
    return { badge: null, text: `${ago} Confirm within ${days(freshness.daysLeft)} to stay visible.` };
  }
  return { badge: null, text: ago };
}

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
