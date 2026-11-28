import type { MetadataRoute } from "next";
import { releasedSwitches } from "@/lib/dal/release";
import {
  listPublishedLegalSlugs,
  listSitemapCompanies,
  listSitemapCorridorPaths,
  listSitemapPartners,
  listSitemapVacancies,
} from "@/lib/dal/sitemap";
import { env } from "@/lib/env";
import { defaultLocale } from "@/lib/i18n/locale";
import { legalSlugs, networkFeatures, rankingGroup, releasedPagePaths } from "@/lib/public/navigation";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [released, corridors] = await Promise.all([releasedSwitches(), listSitemapCorridorPaths()]);
  const capacity = vacancyCapacity(legalSlugs.length + networkFeatures.length + rankingGroup.links.length + corridors.length);
  const [published, vacancies, partners, companies] = await Promise.all([
    listPublishedLegalSlugs(legalSlugs),
    listSitemapVacancies(capacity),
    listSitemapPartners(capacity),
    listSitemapCompanies(capacity),
  ]);
  return sitemapEntries({
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    lang: defaultLocale,
    legalSlugs: published,
    networkPaths: [...releasedPagePaths(released), ...corridors],
    vacancies,
    partners,
    companies,
  });
}
