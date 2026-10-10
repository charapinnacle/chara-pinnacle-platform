import type { MetadataRoute } from "next";
import { formatIsoDate } from "@/lib/i18n/format";
import { staticPages } from "./pages";

// The protocol allows 50,000 URLs in one file; the capacity target is far below it (NFR-P1), so there is one file.
const SITEMAP_URL_LIMIT = 50_000;

export type SitemapVacancy = { id: string; updatedAt: string };

const staticCount = Object.keys(staticPages).length;

export function vacancyCapacity(legalPages: number): number {
  return SITEMAP_URL_LIMIT - staticCount - legalPages;
}

// The pages everybody may read and the open vacancies, as absolute addresses. Nothing else belongs here, and no
// address has a query string; a vacancy carries the date it last changed, the other pages none.
export function sitemapEntries(input: {
  siteUrl: string;
  lang: string;
  legalSlugs: readonly string[];
  vacancies: readonly SitemapVacancy[];
}): MetadataRoute.Sitemap {
  const { siteUrl, lang, legalSlugs, vacancies } = input;
  const at = (path: string) => `${siteUrl}/${lang}${path}`;
  return [
    ...Object.values(staticPages).map(({ path }) => ({ url: at(path ? `/${path}` : "") })),
    ...legalSlugs.map((slug) => ({ url: at(`/legal/${slug}`) })),
    ...vacancies.map(({ id, updatedAt }) => ({ url: at(`/jobs/${id}`), lastModified: formatIsoDate(updatedAt) })),
  ];
}
