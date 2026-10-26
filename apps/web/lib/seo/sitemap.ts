import type { MetadataRoute } from "next";
import { formatIsoDate } from "@/lib/i18n/format";
import { staticPages } from "./pages";

// The protocol allows 50,000 URLs in one file; the capacity target is far below it (NFR-P1), so there is one file.
const SITEMAP_URL_LIMIT = 50_000;

export type SitemapVacancy = { id: string; updatedAt: string };
export type SitemapPartner = { slug: string; updatedAt: string };
export type SitemapCompany = { slug: string; updatedAt: string };

const staticCount = Object.keys(staticPages).length;

// The room left for vacancies, partner profiles and company pages together, after the static pages and the given number of
// other pages (the legal pages and the released pages of the network).
export function vacancyCapacity(otherPages: number): number {
  return SITEMAP_URL_LIMIT - staticCount - otherPages;
}

// The pages everybody may read, the pages of the network whose release is on (FR-L5 AC3: the partner directories in
// release 2a), the open vacancies, the public partner profiles (FR-K4 AC7) and the company pages with an open vacancy
// (FR-K5 AC10), as absolute addresses. Nothing else belongs here, and no address has a query string; a
// vacancy, a profile and a company page carry the date they last changed, the other pages none. Vacancies come first;
// the profiles and then the company pages fill what is left of the file.
export function sitemapEntries(input: {
  siteUrl: string;
  lang: string;
  legalSlugs: readonly string[];
  networkPaths?: readonly string[];
  vacancies: readonly SitemapVacancy[];
  partners?: readonly SitemapPartner[];
  companies?: readonly SitemapCompany[];
}): MetadataRoute.Sitemap {
  const { siteUrl, lang, legalSlugs, networkPaths = [], vacancies, partners = [], companies = [] } = input;
  const at = (path: string) => `${siteUrl}/${lang}${path}`;
  const room = Math.max(vacancyCapacity(legalSlugs.length + networkPaths.length) - vacancies.length, 0);
  const listedPartners = partners.slice(0, room);
  return [
    ...Object.values(staticPages).map(({ path }) => ({ url: at(path ? `/${path}` : "") })),
    ...networkPaths.map((path) => ({ url: at(`/${path}`) })),
    ...legalSlugs.map((slug) => ({ url: at(`/legal/${slug}`) })),
    ...vacancies.map(({ id, updatedAt }) => ({ url: at(`/jobs/${id}`), lastModified: formatIsoDate(updatedAt) })),
    ...listedPartners.map(({ slug, updatedAt }) => ({ url: at(`/partners/${slug}`), lastModified: formatIsoDate(updatedAt) })),
    ...companies
      .slice(0, room - listedPartners.length)
      .map(({ slug, updatedAt }) => ({ url: at(`/companies/${slug}`), lastModified: formatIsoDate(updatedAt) })),
  ];
}
