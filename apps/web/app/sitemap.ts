import type { MetadataRoute } from "next";
import { listPublishedLegalSlugs, listSitemapVacancies } from "@/lib/dal/sitemap";
import { env } from "@/lib/env";
import { defaultLocale } from "@/lib/i18n/locale";
import { legalSlugs } from "@/lib/public/navigation";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [published, vacancies] = await Promise.all([
    listPublishedLegalSlugs(legalSlugs),
    listSitemapVacancies(vacancyCapacity(legalSlugs.length)),
  ]);
  return sitemapEntries({ siteUrl: env.NEXT_PUBLIC_SITE_URL, lang: defaultLocale, legalSlugs: published, vacancies });
}
