import type { MetadataRoute } from "next";
import { releasedSwitches } from "@/lib/dal/release";
import { listPublishedLegalSlugs, listSitemapCompanies, listSitemapPartners, listSitemapVacancies } from "@/lib/dal/sitemap";
import { env } from "@/lib/env";
import { defaultLocale } from "@/lib/i18n/locale";
import { legalSlugs, networkFeatures, networkMenu } from "@/lib/public/navigation";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const capacity = vacancyCapacity(legalSlugs.length + networkFeatures.length);
  const [released, published, vacancies, partners, companies] = await Promise.all([
    releasedSwitches(),
    listPublishedLegalSlugs(legalSlugs),
    listSitemapVacancies(capacity),
    listSitemapPartners(capacity),
    listSitemapCompanies(capacity),
  ]);
  return sitemapEntries({
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    lang: defaultLocale,
    legalSlugs: published,
    networkPaths: networkMenu(released).links.map(({ path }) => path),
    vacancies,
    partners,
    companies,
  });
}
