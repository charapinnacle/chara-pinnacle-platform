import type { Metadata } from "next";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyPageView } from "@/components/companies/company-page-view";
import { companyPageFrom, companyViewerOf, type CompanyPage } from "@/lib/companies/page";
import { robotsDisallow } from "@/lib/seo/private-routes";
import { companyPageMetadata } from "@/lib/seo/metadata";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

const SITE = "http://localhost:3100";

const vacancy = (n: number) => ({
  id: `0a1b2c3d-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Welder ${n}`,
  city: "Hamburg",
  country_code: "DE",
  country: "Germany",
  employment_type: "full_time",
  salary_min: 2800,
  salary_max: 3400,
  salary_currency: "EUR",
  salary_period: "month",
  published_at: "2026-10-20T08:00:00+00:00",
});

const row = {
  slug: "acme-bau",
  display_name: "Acme Bau",
  based_in_country: "DE",
  based_in_country_name: "Germany",
  industry_code: "F",
  industry_name: "Construction",
  website: "https://acme-bau.example",
  description: "We build steel halls\n\nin northern Germany.",
  open_vacancy_count: 2,
  vacancies: [vacancy(1), vacancy(2)],
};

const withVacancies: CompanyPage = companyPageFrom(row);
const withoutVacancies: CompanyPage = companyPageFrom({ ...row, open_vacancy_count: 0, vacancies: [] });

const titleOf = (metadata: Metadata) => (metadata.title as { absolute: string }).absolute;

describe("companyPageFrom (FR-K5 AC3)", () => {
  it("maps the row of get_company_page to the page it shows", () => {
    expect(withVacancies).toMatchObject({
      slug: "acme-bau",
      displayName: "Acme Bau",
      basedIn: { code: "DE", name: "Germany" },
      industry: { code: "F", name: "Construction" },
      website: "https://acme-bau.example",
      openVacancyCount: 2,
    });
    expect(withVacancies.vacancies[0]).toEqual({
      id: vacancy(1).id,
      title: "Welder 1",
      city: "Hamburg",
      country: "Germany",
      employmentType: "full_time",
      salaryMin: 2800,
      salaryMax: 3400,
      salaryCurrency: "EUR",
      salaryPeriod: "month",
      publishedAt: "2026-10-20T08:00:00+00:00",
    });
  });

  it("gives null for an industry, website or description the company did not enter", () => {
    const page = companyPageFrom({ ...row, industry_code: "", industry_name: "", website: "", description: "" });
    expect(page.industry).toBeNull();
    const nulls = JSON.parse(JSON.stringify({ ...row, industry_code: null, industry_name: null, website: null, description: null })) as typeof row;
    expect(companyPageFrom(nulls)).toMatchObject({ industry: null, website: null, description: null });
  });

  it("refuses vacancies of another shape", () => {
    expect(() => companyPageFrom({ ...row, vacancies: [{ id: 1 }] })).toThrow();
  });
});

describe("companyViewerOf (FR-K5 AC8)", () => {
  it("lets an owner and an admin manage the page, a member only read it, and everyone else report it", () => {
    expect([companyViewerOf("owner"), companyViewerOf("admin"), companyViewerOf("member"), companyViewerOf(null)]).toEqual([
      "manager",
      "manager",
      "member",
      "outsider",
    ]);
  });
});

describe("companyPageMetadata (FR-K5 AC10)", () => {
  it("gives the title of the criterion and the canonical address without a query string", () => {
    const metadata = companyPageMetadata("en", withVacancies);
    expect(titleOf(metadata)).toBe("Acme Bau - Construction company in Germany | Chara Pinnacle");
    expect(metadata.alternates?.canonical).toBe(`${SITE}/en/companies/acme-bau`);
    expect(metadata.robots).toBeUndefined();
  });

  it("describes the company from its own text in at most 160 characters, or from its fields without one", () => {
    expect(companyPageMetadata("en", withVacancies).description).toBe("We build steel halls in northern Germany.");
    const long = companyPageMetadata("en", { ...withVacancies, description: "x".repeat(400) });
    expect(String(long.description).length).toBeLessThanOrEqual(160);
    expect(companyPageMetadata("en", { ...withVacancies, description: null }).description).toBe(
      "Open vacancies at Acme Bau, construction company based in Germany.",
    );
  });

  it("names the country with its article and a company without an industry plainly", () => {
    const page = { ...withVacancies, basedIn: { code: "PH", name: "Philippines" }, industry: null };
    expect(titleOf(companyPageMetadata("en", page))).toBe("Acme Bau - Company in the Philippines | Chara Pinnacle");
  });

  it("cuts a long name before the product name, never the product name", () => {
    const title = titleOf(companyPageMetadata("en", { ...withVacancies, displayName: "A".repeat(120) }));
    expect(title.endsWith(" | Chara Pinnacle")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(70 + " | Chara Pinnacle".length);
  });

  it("keeps a page without an open vacancy out of the index", () => {
    expect(companyPageMetadata("en", withoutVacancies).robots).toEqual({ index: false, follow: true });
  });
});

describe("the sitemap entries of the company pages (FR-K5 AC10)", () => {
  const companies = [{ slug: "acme-bau", updatedAt: "2026-10-20T08:00:00+00:00" }];
  const partners = [{ slug: "manila-skills", updatedAt: "2026-10-19T08:00:00+00:00" }];

  it("lists each given page after the vacancies and partner profiles with the date of its last change", () => {
    const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies: [], partners, companies });
    expect(entries.slice(-2)).toEqual([
      { url: `${SITE}/en/partners/manila-skills`, lastModified: "2026-10-19" },
      { url: `${SITE}/en/companies/acme-bau`, lastModified: "2026-10-20" },
    ]);
  });

  it("lists no company page when the database gives none (release off, page off or no open vacancy)", () => {
    const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies: [] });
    expect(entries.some(({ url }) => url.includes("/companies/"))).toBe(false);
  });

  it("keeps the file under the limit of the protocol: the company pages fill what the vacancies and profiles leave", () => {
    const capacity = vacancyCapacity(0);
    const vacancies = Array.from({ length: capacity - 1 }, (_, n) => ({ id: String(n), updatedAt: "2026-10-01T00:00:00Z" }));
    const many = [...companies, { slug: "beta-works", updatedAt: "2026-10-20T08:00:00+00:00" }];
    expect(sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies, companies: many }).filter(({ url }) => url.includes("/companies/"))).toHaveLength(1);
    expect(sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies, partners, companies: many }).filter(({ url }) => url.includes("/companies/"))).toHaveLength(0);
  });

  it("leaves the company pages out of the robots disallow list", () => {
    expect(robotsDisallow.some((path) => "/en/companies/acme-bau".startsWith(path))).toBe(false);
  });
});

describe("CompanyPageView (FR-K5 AC3, AC10)", () => {
  it("shows the details, the website as an external link and each open vacancy linking to its page", () => {
    const html = renderToStaticMarkup(<CompanyPageView lang="en" page={withVacancies} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Construction · Based in Germany");
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain(`href="/en/jobs/${vacancy(1).id}"`);
    expect(html).toContain(`href="/en/jobs/${vacancy(2).id}"`);
    expect(html).not.toContain("No open vacancies right now");
  });

  it("shows the empty state for a page without an open vacancy", () => {
    const html = renderToStaticMarkup(<CompanyPageView lang="en" page={withoutVacancies} />);
    expect(html).toContain("No open vacancies right now");
    expect(html).not.toContain("/en/jobs/");
  });

  it("says how many vacancies are left out when there are more than it shows", () => {
    const html = renderToStaticMarkup(<CompanyPageView lang="en" page={{ ...withVacancies, openVacancyCount: 130 }} />);
    expect(html).toContain("The 2 newest of 130 open vacancies.");
  });

  it("shows the description as text, never as markup", () => {
    const html = renderToStaticMarkup(<CompanyPageView lang="en" page={{ ...withVacancies, description: "<b>Join</b> <script>x()</script>" }} />);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script");
  });
});
