import { describe, expect, it } from "vitest";
import { legalSlugs, networkMenu } from "@/lib/public/navigation";
import { robotsDisallow } from "@/lib/seo/private-routes";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

const SITE = "https://chara.example";
const vacancies = [
  { id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11", updatedAt: "2026-10-06T23:59:59.123456+00:00" },
  { id: "0a1b2c3d-0000-4000-8000-000000000002", updatedAt: "2026-09-01T00:00:00+00:00" },
];
const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs, vacancies });
const paths = entries.map((entry) => new URL(entry.url).pathname);

describe("the sitemap entries (FR-H5 AC3)", () => {
  it("lists the eight pages (For employers among them, D90; Pricing is hidden), the ten legal pages and the given vacancies, 20 addresses in all", () => {
    expect(entries).toHaveLength(20);
    expect(paths.slice(0, 8)).toEqual([
      "/en",
      "/en/jobs",
      "/en/how-it-works",
      "/en/employers",
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
    expect(vacancyCapacity(10) + 9 + 10).toBe(50_000);
  });
});

describe("the pages of the network in the sitemap (FR-L5 AC3)", () => {
  const networkPaths = (released: Parameters<typeof networkMenu>[0]) => networkMenu(released).links.map(({ path }) => path);
  const pathsOf = (released: Parameters<typeof networkMenu>[0]) =>
    sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], networkPaths: networkPaths(released), vacancies: [] }).map(
      (entry) => new URL(entry.url).pathname,
    );

  it("lists none of them while every release is off", () => {
    expect(pathsOf([])).toHaveLength(9);
    for (const path of ["/en/partners/recruitment", "/en/partners/staffing", "/en/job-orders", "/en/companies", "/en/find-workers", "/en/request-workers"]) {
      expect(pathsOf([])).not.toContain(path);
    }
  });

  it("lists the two partner directories after the static pages, without a date, once release 2a is on, and no page of 2b or 2c", () => {
    const entriesOn = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], networkPaths: networkPaths(["release_partner_directories"]), vacancies });
    expect(entriesOn.map((entry) => new URL(entry.url).pathname).slice(9, 11)).toEqual(["/en/partners/recruitment", "/en/partners/staffing"]);
    expect(entriesOn.slice(9, 11).every((entry) => entry.lastModified === undefined)).toBe(true);
    const every = pathsOf(["release_partner_directories", "release_job_orders", "release_find_workers", "release_candidate_submissions", "release_messaging"]);
    expect(every).toHaveLength(11);
    for (const path of ["/en/job-orders", "/en/companies", "/en/find-workers", "/en/request-workers"]) expect(every).not.toContain(path);
  });

  it("keeps the vacancies, profiles and company pages within the file after the network pages", () => {
    const network = networkPaths(["release_partner_directories"]);
    const full = sitemapEntries({
      siteUrl: SITE,
      lang: "en",
      legalSlugs: [],
      networkPaths: network,
      vacancies: [],
      partners: Array.from({ length: vacancyCapacity(network.length) + 5 }, (_, index) => ({ slug: `p-${index}`, updatedAt: "2026-10-06T10:00:00Z" })),
    });
    expect(full).toHaveLength(50_000);
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
