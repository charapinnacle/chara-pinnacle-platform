import type { MetadataRoute } from "next";
import { listPublishedLegalSlugs, listSitemapPartners, listSitemapVacancies } from "@/lib/dal/sitemap";
import { env } from "@/lib/env";
import { defaultLocale } from "@/lib/i18n/locale";
import { legalSlugs } from "@/lib/public/navigation";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const capacity = vacancyCapacity(legalSlugs.length);
  const [published, vacancies, partners] = await Promise.all([
    listPublishedLegalSlugs(legalSlugs),
    listSitemapVacancies(capacity),
    listSitemapPartners(capacity),
  ]);
  return sitemapEntries({ siteUrl: env.NEXT_PUBLIC_SITE_URL, lang: defaultLocale, legalSlugs: published, vacancies, partners });
}
