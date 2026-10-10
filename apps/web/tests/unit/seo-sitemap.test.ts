import { describe, expect, it } from "vitest";
import { legalSlugs } from "@/lib/public/navigation";
import { robotsDisallow } from "@/lib/seo/private-routes";
import { sitemapEntries, SITEMAP_URL_LIMIT, vacancyCapacity } from "@/lib/seo/sitemap";

const SITE = "https://chara.example";
const vacancies = [
  { id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11", updatedAt: "2026-10-06T23:59:59.123456+00:00" },
  { id: "0a1b2c3d-0000-4000-8000-000000000002", updatedAt: "2026-09-01T00:00:00+00:00" },
];
const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs, vacancies });
const paths = entries.map((entry) => new URL(entry.url).pathname);

describe("the sitemap entries (FR-H5 AC3)", () => {
  it("lists the eight pages, the ten legal pages and the given vacancies, 20 addresses in all", () => {
    expect(entries).toHaveLength(20);
    expect(paths.slice(0, 8)).toEqual([
      "/en",
      "/en/jobs",
      "/en/pricing",
      "/en/how-it-works",
      "/en/trust-safety",
      "/en/about",
      "/en/contact",
      "/en/imprint",
    ]);
    expect(paths.slice(8, 18)).toEqual(legalSlugs.map((slug) => `/en/legal/${slug}`));
    expect(paths.slice(18)).toEqual(vacancies.map((vacancy) => `/en/jobs/${vacancy.id}`));
  });

  it("makes every address absolute on the site", () => {
    for (const { url } of entries) expect(url.startsWith(`${SITE}/en`), url).toBe(true);
  });

  it("gives a vacancy the UTC date of its last change as lastmod, and no other page one", () => {
    expect(entries.slice(18).map((entry) => entry.lastModified)).toEqual(["2026-10-06", "2026-09-01"]);
    expect(entries.slice(0, 18).every((entry) => entry.lastModified === undefined)).toBe(true);
  });

  it("lists only the legal pages that the database reports as published", () => {
    const some = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: ["terms-of-service"], vacancies: [] });
    expect(some.map((entry) => new URL(entry.url).pathname).slice(8)).toEqual(["/en/legal/terms-of-service"]);
  });

  it("leaves room for the vacancies under the limit of the protocol", () => {
    expect(vacancyCapacity(10) + 8 + 10).toBe(SITEMAP_URL_LIMIT);
  });
});

describe("private areas never enter the sitemap (FR-H5 AC5)", () => {
  const forbidden = [
    "/en/dashboard",
    "/en/org",
    "/en/passport",
    "/en/applications",
    "/en/admin",
    "/en/onboarding",
    "/en/login",
    "/en/signup",
    "/en/verify-email",
    "/en/forgot-password",
    "/en/mfa",
    "/auth",
    "/api",
  ];

  it("has no address that starts with a private path", () => {
    for (const path of paths) {
      for (const prefix of forbidden) expect(path.startsWith(prefix), `${path} / ${prefix}`).toBe(false);
    }
  });

  it("has no address with a query string or a fragment", () => {
    for (const { url } of entries) {
      expect(new URL(url).search, url).toBe("");
      expect(url.includes("#"), url).toBe(false);
    }
  });

  it("is not blocked by the robots file for any of its addresses", () => {
    const blocked = robotsDisallow.map((rule) => new RegExp(`^${rule.replaceAll("*", "[^/]*").replace(/[.+?^${}()|[\]\\]/g, "\\$&")}`));
    for (const path of paths) expect(blocked.some((rule) => rule.test(path)), path).toBe(false);
  });
});
