const locales = ["en"] as const;
type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

const UNPREFIXED_SEGMENTS = ["auth", "api"];

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

// The country of the region subtag of the most preferred language that names one in the list ("de-AT" gives AT), or ""
// when none does: a language alone ("de") or a numeric region ("es-419") says nothing about the country.
export function countryFromAcceptLanguage(header: string | null, countryCodes: readonly string[]): string {
  if (!header) return "";
  const ranked = header
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.map((parameter) => /^\s*q=([\d.]+)\s*$/.exec(parameter)?.[1]).find(Boolean);
      return { tag, quality: quality === undefined ? 1 : Number(quality), index };
    })
    .filter(({ quality }) => quality > 0)
    .toSorted((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const region = tag.split("-").slice(1).find((subtag) => /^[A-Za-z]{2}$/.test(subtag))?.toUpperCase();
    if (region && countryCodes.includes(region)) return region;
  }
  return "";
}

export function localeRedirectPath(pathname: string): string | null {
  const first = pathname.split("/")[1] ?? "";
  if (isLocale(first) || UNPREFIXED_SEGMENTS.includes(first)) return null;
  return `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
}
