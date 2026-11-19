import type { SavedSearch } from "@/lib/dal/find-employers";
import { formatCount } from "@/lib/i18n/format";

export type ReferenceNames = {
  countries: Map<string, string>;
  industries: Map<string, string>;
  occupations: Map<string, string>;
};

// FR-L3 AC7: an anonymous job order reads "Manufacturing, Germany, 100 Welders and flame cutters": the industry the
// database returns (full rows only) before the neutral title, which already holds the destination, size and occupation.
export function anonymousJobOrderText(title: string, industryCode: string | null, names: ReferenceNames): string {
  return industryCode ? `${names.industries.get(industryCode) ?? industryCode}, ${title}` : title;
}

export function resultCountText(count: number, hasMore: boolean): string {
  return `${formatCount(count)} ${count === 1 ? "result" : "results"} shown${hasMore ? ", more on the next page" : ""}`;
}

export function vacancyCountText(count: number): string {
  return `${formatCount(count)} public ${count === 1 ? "vacancy" : "vacancies"}`;
}

export function jobOrderCountText(count: number): string {
  return `${formatCount(count)} open ${count === 1 ? "job order" : "job orders"} for you`;
}

// The filters of a saved search in words, in the order of the form.
export function savedSearchText(saved: SavedSearch, names: ReferenceNames): string {
  return [
    saved.destination ? (names.countries.get(saved.destination) ?? saved.destination) : null,
    saved.industry ? (names.industries.get(saved.industry) ?? saved.industry) : null,
    saved.occupation ? `${saved.occupation} ${names.occupations.get(saved.occupation) ?? ""}`.trim() : null,
    saved.minWorkers !== null ? `at least ${formatCount(saved.minWorkers)} workers` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
