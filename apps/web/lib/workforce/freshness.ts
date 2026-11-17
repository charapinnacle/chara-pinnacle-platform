import { formatCount, formatDate } from "@/lib/i18n/format";

// Without zod, so that the client part of the partner dashboard does not load the validation library (bundle budget).

const DAY_MS = 86_400_000;

// The periods of the public settings workforce_listing_stale_days, workforce_confirm_reminder_days and
// workforce_available_from_max_days.
export type AvailabilityRules = { staleDays: number; reminderDays: number; maxDays: number };

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

export function confirmedAgo(confirmedAt: string, now: Date): string {
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

// The workers of a listing as the available workforce search counts them (search_available_workforce: available now only
// when available_from is today or earlier in UTC): a listing that starts later says from when, never "available now".
export function availabilityText(
  listing: { available: number; monthlyCapacity: number; availableFrom: string },
  now: Date,
): string {
  const later = listing.availableFrom > now.toISOString().slice(0, 10);
  return later
    ? `${formatCount(listing.available)} available from ${formatDate(listing.availableFrom)}, ${formatCount(listing.monthlyCapacity)} per month`
    : `${formatCount(listing.available)} available now, ${formatCount(listing.monthlyCapacity)} per month`;
}
