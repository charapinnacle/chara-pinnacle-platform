import type { Database } from "@chara-pinnacle/db-types";
import { segmentOf } from "@/lib/dashboard/segments";
import { companyDashboardPath, homePath, onboardingPath } from "@/lib/routes";

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
  return target === "/" || target.startsWith(`/${lang}/consent`) ? onboardingPath(lang) : target;
}

export function mfaReturnPath(lang: string, next: string | null | undefined, fallback: string): string {
  const target = safeNextPath(next);
  return target === "/" || target.startsWith(`/${lang}/mfa`) ? fallback : target;
}

// Where a signed-in person who opens the login page goes instead: the page they were sent to log in for, else their
// home (the dashboard of their account kind, or onboarding while it has none). A company account goes to the dashboard
// of the type of its first organisation, so a recruitment or staffing company does not pass through the employer one.
export function signedInLoginTarget(
  lang: string,
  next: string | null | undefined,
  accountKind: Database["public"]["Enums"]["account_kind"] | null,
  firstOrganization?: { slug: string; type: Database["public"]["Enums"]["organization_type"] } | null,
): string {
  const target = safeNextPath(next);
  if (target !== "/" && !target.startsWith(`/${lang}/login`)) return target;
  if (accountKind === "company" && firstOrganization && firstOrganization.type !== "employer") {
    return companyDashboardPath(lang, segmentOf(firstOrganization.type), firstOrganization.slug);
  }
  return homePath(lang, accountKind);
}
