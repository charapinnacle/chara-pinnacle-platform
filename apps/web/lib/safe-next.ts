const PLACEHOLDER_ORIGIN = "http://localhost";

export function safeNextPath(next: string | null | undefined): string {
  // Browsers drop tabs and newlines and read backslashes as slashes, so these
  // turn "/\t/host" or "/\host" into a protocol-relative URL.
  if (!next || !next.startsWith("/") || /[\\\p{Cc}]/u.test(next)) {
    return "/";
  }
  const url = new URL(next, PLACEHOLDER_ORIGIN);
  if (url.origin !== PLACEHOLDER_ORIGIN || url.pathname.startsWith("//")) {
    return "/";
  }
  return url.pathname + url.search + url.hash;
}

export function consentReturnPath(lang: string, next: string): string {
  const target = safeNextPath(next);
  return target === "/" || target.startsWith(`/${lang}/consent`)
    ? `/${lang}/onboarding`
    : target;
}
