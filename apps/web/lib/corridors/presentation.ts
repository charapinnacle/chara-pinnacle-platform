import { formatCount } from "@/lib/i18n/format";
import { formFilters, partnerDirectoryPath } from "@/lib/partners/search-params";
import { CORRIDORS_PATH, NETWORK_PATH } from "@/lib/public/navigation";

// The address of a corridor is its two country codes in lower case, source first (/corridors/ph-de); the upper-case
// spelling redirects there, anything else is not found. A network page is one lower-case code (/network/de).
const CORRIDOR = /^([a-z]{2})-([a-z]{2})$/i;
const COUNTRY = /^[a-z]{2}$/i;

export type CorridorAddress = { source: string; destination: string; canonical: boolean };

export function parseCorridorSlug(slug: string): CorridorAddress | null {
  const match = CORRIDOR.exec(slug);
  if (!match || match[1].toLowerCase() === match[2].toLowerCase()) return null;
  return { source: match[1].toUpperCase(), destination: match[2].toUpperCase(), canonical: slug === slug.toLowerCase() };
}

export function parseNetworkSlug(slug: string): { destination: string; canonical: boolean } | null {
  if (!COUNTRY.test(slug)) return null;
  return { destination: slug.toUpperCase(), canonical: slug === slug.toLowerCase() };
}

export function corridorsPath(lang: string): string {
  return `/${lang}/${CORRIDORS_PATH}`;
}

// The path of a corridor under the language, as the sitemap lists it.
export function corridorPagePath(source: string, destination: string): string {
  return `${CORRIDORS_PATH}/${source.toLowerCase()}-${destination.toLowerCase()}`;
}

export function corridorPath(lang: string, source: string, destination: string): string {
  return `/${lang}/${corridorPagePath(source, destination)}`;
}

export function networkPath(lang: string, destination: string): string {
  return `/${lang}/${NETWORK_PATH}/${destination.toLowerCase()}`;
}

// The directories pre-filtered for the corridor. The recruitment directory filters by destination and ranks the
// companies sourcing from the source country first; the staffing directory has no source-country filter (spec section
// 15), so it is filtered by destination only.
export function corridorDirectoryPaths(lang: string, source: string, destination: string) {
  return {
    recruitment: partnerDirectoryPath(lang, "recruitment", formFilters({ destination, sources_from: [source] })),
    staffing: partnerDirectoryPath(lang, "staffing", formFilters({ destination })),
  };
}

// A count the database held back (null) is fewer than its threshold; it is never shown as a number (D73).
export function countText(count: number | null, minCount: number): string {
  return count === null ? `Fewer than ${minCount}` : formatCount(count);
}

export function workforceText(range: string | null): string {
  return range === null ? "Not shown yet" : range;
}

// The address filters of the index: two-letter codes, any case; anything else is ignored.
export function parseCorridorFilters(raw: Record<string, string | string[] | undefined>): { source?: string; destination?: string } {
  const code = (value: string | string[] | undefined) => {
    const first = Array.isArray(value) ? value[0] : value;
    return first !== undefined && COUNTRY.test(first.trim()) ? first.trim().toUpperCase() : undefined;
  };
  return { source: code(raw.source), destination: code(raw.destination) };
}
