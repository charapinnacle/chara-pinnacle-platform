export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

const UNPREFIXED_SEGMENTS = ["auth", "api"];

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function negotiateLocale(acceptLanguage: string | null): Locale {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      const weight = q ? Number(q.trim().slice(2)) : 1;
      return {
        language: tag.trim().toLowerCase().split("-")[0],
        weight: Number.isNaN(weight) ? 0 : weight,
      };
    })
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight);
  return ranked.map(({ language }) => language).find(isLocale) ?? defaultLocale;
}

export function localeRedirectPath(
  pathname: string,
  acceptLanguage: string | null,
): string | null {
  const first = pathname.split("/")[1] ?? "";
  if (isLocale(first) || UNPREFIXED_SEGMENTS.includes(first)) return null;
  const locale = negotiateLocale(acceptLanguage);
  return pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
}
