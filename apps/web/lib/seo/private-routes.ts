import { defaultLocale } from "@/lib/i18n/locale";

// The first segment after the language of every page that is not for search engines: what sits behind a login, the
// sign-in pages and the pages that tell a signed-in person no. The robots file lists them and the proxy marks their
// responses noindex; a test walks the route groups of the app so that a new private page cannot be left out.
export const privateSegments = [
  "admin",
  "applications",
  "confirm-email",
  "consent",
  "dashboard",
  "forbidden",
  "forgot-password",
  "invitations",
  "login",
  "mfa",
  "onboarding",
  "org",
  "passport",
  "reset-password",
  "saved",
  "settings",
  "signup",
  "suspended",
  "verify-email",
] as const;

// The routes that have no language in the address.
const unprefixedPrivateSegments = ["auth", "api"] as const;

// Applying is private although it sits under the public address of the vacancy: /en/jobs/<id>/apply.
const APPLY_SEGMENT = "apply";

export function isPrivatePath(pathname: string): boolean {
  const [, first, second, third, fourth] = pathname.split("/");
  if ((unprefixedPrivateSegments as readonly string[]).includes(first)) return true;
  if (first !== defaultLocale) return false;
  if ((privateSegments as readonly string[]).includes(second)) return true;
  return second === "jobs" && third !== undefined && fourth === APPLY_SEGMENT;
}

// * is a wildcard that the crawlers of the large search engines understand.
export const robotsDisallow: string[] = [
  ...privateSegments.map((segment) => `/${defaultLocale}/${segment}`),
  `/${defaultLocale}/jobs/*/${APPLY_SEGMENT}`,
  ...unprefixedPrivateSegments.map((segment) => `/${segment}/`),
];
