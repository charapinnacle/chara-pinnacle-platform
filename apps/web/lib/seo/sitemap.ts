import type { MetadataRoute } from "next";
import { formatIsoDate } from "@/lib/i18n/format";
import { SHOW_PRICING } from "@/lib/public/navigation";
import { staticPages } from "./pages";

// The protocol allows 50,000 URLs in one file; the capacity target is far below it (NFR-P1), so there is one file.
const SITEMAP_URL_LIMIT = 50_000;

export type SitemapVacancy = { id: string; updatedAt: string };
export type SitemapPartner = { slug: string; updatedAt: string };

const staticCount = Object.keys(staticPages).length;

// The room left for vacancies and partner profiles together.
export function vacancyCapacity(legalPages: number): number {
  return SITEMAP_URL_LIMIT - staticCount - legalPages;
}

// The pages everybody may read, the open vacancies and the public partner profiles (FR-K4 AC7), as absolute addresses.
// Nothing else belongs here, and no address has a query string; a vacancy and a profile carry the date they last
// changed, the other pages none. Vacancies come first; the profiles fill what is left of the file.
export function sitemapEntries(input: {
  siteUrl: string;
  lang: string;
  legalSlugs: readonly string[];
  vacancies: readonly SitemapVacancy[];
  partners?: readonly SitemapPartner[];
}): MetadataRoute.Sitemap {
  const { siteUrl, lang, legalSlugs, vacancies, partners = [] } = input;
  const at = (path: string) => `${siteUrl}/${lang}${path}`;
  const room = Math.max(vacancyCapacity(legalSlugs.length) - vacancies.length, 0);
  return [
    ...Object.values(staticPages).filter(({ path }) => SHOW_PRICING || path !== "pricing").map(({ path }) => ({ url: at(path ? `/${path}` : "") })),
    ...legalSlugs.map((slug) => ({ url: at(`/legal/${slug}`) })),
    ...vacancies.map(({ id, updatedAt }) => ({ url: at(`/jobs/${id}`), lastModified: formatIsoDate(updatedAt) })),
    ...partners
      .slice(0, room)
      .map(({ slug, updatedAt }) => ({ url: at(`/partners/${slug}`), lastModified: formatIsoDate(updatedAt) })),
  ];
}
