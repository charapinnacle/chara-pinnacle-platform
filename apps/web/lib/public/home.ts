import type { PhotoName } from "@/lib/public/photos";
import { formatCount } from "@/lib/i18n/format";

type Named = { code: string; name: string };
type Occupation = { code: string; label: string; synonyms: string[] };

// The popular searches under the hero: ISCO-08 unit groups of the reference data (welder, electrician, nurse, truck driver,
// chef, carpenter). A code the data does not hold is left out, so a chip always opens a filter that exists.
export const POPULAR_OCCUPATIONS = ["7212", "7411", "2221", "8332", "3434", "7115"] as const;

// The six industries of the photo tiles, ISIC Rev.4 sections of the reference data. Logistics and transport are one section (H);
// the warehouse picture illustrates wholesale and retail trade (G), where most warehouse work is (D87).
export const INDUSTRY_TILES: readonly { code: string; label: string; photo: PhotoName }[] = [
  { code: "F", label: "Construction", photo: "construction-team" },
  { code: "Q", label: "Healthcare", photo: "healthcare-nurse" },
  { code: "H", label: "Transport and logistics", photo: "transport-truck" },
  { code: "I", label: "Hospitality", photo: "hospitality-chef" },
  { code: "C", label: "Manufacturing", photo: "hero-welder" },
  { code: "G", label: "Wholesale and retail", photo: "logistics-warehouse" },
];

const COUNTRY_CHIP_LIMIT = 12;

// Below this many open vacancies the latest-jobs section is an empty state with the way to post one, not a short list.
export const LATEST_JOBS_MINIMUM = 3;
export const LATEST_JOBS_SHOWN = 6;

// The everyday name of an occupation is its first synonym in the reference data, with a capital ("Truck driver").
export function popularSearches(occupations: readonly Occupation[]): { code: string; label: string }[] {
  const byCode = new Map(occupations.map((occupation) => [occupation.code, occupation]));
  return POPULAR_OCCUPATIONS.flatMap((code) => {
    const occupation = byCode.get(code);
    if (!occupation) return [];
    const word = occupation.synonyms[0] ?? occupation.label;
    return [{ code, label: word.charAt(0).toUpperCase() + word.slice(1) }];
  });
}

// The countries of the given open vacancies, the one with the most first (then by name), at most twelve.
export function countryChips(jobs: readonly { countryCode: string }[], countries: readonly Named[]): Named[] {
  const tally = new Map<string, number>();
  for (const { countryCode } of jobs) tally.set(countryCode, (tally.get(countryCode) ?? 0) + 1);
  const names = new Map(countries.map(({ code, name }) => [code, name]));
  return [...tally]
    .flatMap(([code, count]) => {
      const name = names.get(code);
      return name ? [{ code, name, count }] : [];
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en"))
    .slice(0, COUNTRY_CHIP_LIMIT)
    .map(({ code, name }) => ({ code, name }));
}

// The size of the reference data: true at any scale, unlike the live counts.
export function reachFigures(sizes: { countries: number; occupations: number; industries: number; languages: number }) {
  return [
    { label: "Countries and territories", value: formatCount(sizes.countries) },
    { label: "Occupations (ISCO-08)", value: formatCount(sizes.occupations) },
    { label: "Industries (ISIC Rev.4)", value: formatCount(sizes.industries) },
    { label: "Languages", value: formatCount(sizes.languages) },
  ];
}
