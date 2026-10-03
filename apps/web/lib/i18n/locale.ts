const locales = ["en"] as const;
type Locale = (typeof locales)[number];
const defaultLocale: Locale = "en";

const UNPREFIXED_SEGMENTS = ["auth", "api"];

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function localeRedirectPath(pathname: string): string | null {
  const first = pathname.split("/")[1] ?? "";
  if (isLocale(first) || UNPREFIXED_SEGMENTS.includes(first)) return null;
  return `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
}
