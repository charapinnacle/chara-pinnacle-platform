import type { FindWorkersFilters } from "@/lib/find-workers/search-params";
import { formatCount } from "@/lib/i18n/format";

type MatchContext = Pick<FindWorkersFilters, "current_country" | "destination" | "work_authorization"> & {
  languages: Record<string, string>;
};

// The order in which a card says what it matched, whatever order search_workers names them in.
const matchOrder = [
  "occupation",
  "headline",
  "skills",
  "current_country",
  "destination",
  "availability",
  "experience",
  "language",
  "industry",
  "employment_type",
  "work_authorization",
] as const;

type MatchKey = (typeof matchOrder)[number];

const withCode = (label: string, code: string | undefined) => (code ? `${label} ${code}` : label);

function matchText(key: MatchKey, parts: string[], context: MatchContext): string | null {
  switch (key) {
    case "current_country":
      return withCode("current country", context.current_country);
    case "destination":
      return withCode("destination", context.destination);
    case "work_authorization":
      return withCode("work authorisation", context.work_authorization);
    case "employment_type":
      return "employment type";
    case "language": {
      const [code, level] = parts;
      if (!code || !level) return null;
      return `${context.languages[code] ?? code} (${level})`;
    }
    default:
      return key;
  }
}

const isMatchKey = (value: string): value is MatchKey => (matchOrder as readonly string[]).includes(value);

// The "Matched on" line of a card (FR-Q2 AC7): the filters the card matched in a fixed order, with the chosen country
// codes and the card's own language level; unknown keys are ignored, and a card found without a filter says so.
export function matchedOnText(matchedOn: readonly string[], context: MatchContext): string {
  const items = matchedOn
    .map((entry) => {
      const [key, ...parts] = entry.split(":");
      return isMatchKey(key) ? { key, text: matchText(key, parts, context) } : null;
    })
    .filter((item): item is { key: MatchKey; text: string } => item !== null && item.text !== null)
    .sort((a, b) => matchOrder.indexOf(a.key) - matchOrder.indexOf(b.key));
  return `Matched on: ${items.length > 0 ? items.map(({ text }) => text).join(", ") : "your search"}`;
}

export function resultCountText(count: number, more: boolean): string {
  if (count === 0) return "No workers found.";
  const workers = count === 1 ? "1 worker" : `${formatCount(count)} workers`;
  return more ? `${workers} shown. More are on the next page.` : `${workers} found.`;
}

export type DirectContact = "allowed" | "partner_required" | "blocked";

export const directContactTitles: Record<Exclude<DirectContact, "allowed">, string> = {
  partner_required: "Contact through a licensed partner",
  blocked: "Direct contact is not allowed",
};
