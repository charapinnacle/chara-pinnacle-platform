import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BoostedRail } from "@/components/boosts/boosted-rail";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AvailableWorkforceSearch } from "@/components/partners/available-workforce-search";
import { PartnerResults } from "@/components/partners/partner-results";
import { PartnerSearchForm } from "@/components/partners/partner-search-form";
import { isEmployerMember } from "@/lib/dal/organizations";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { parsePartnerSearchParams, partnerSearchQuery, usesAdvancedFilters } from "@/lib/partners/search-params";
import { RANKING_PATH } from "@/lib/public/navigation";
import { partnerDirectoryMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/partners/recruitment">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_partner_directories")) ? partnerDirectoryMetadata(lang) : {};
}

// The directory of recruitment companies (FR-L1), rendered per request: the address holds the filters and the page
// cursor, so a search can be shared and Back restores it. An employer also finds the Available workforce search here
// (FR-K3). Nothing is shown while release 2a is off. While release_boosts is on, the boosted companies that match the
// search have a rail of their own above the results, read apart from them.
export default async function RecruitmentPartnersPage({ params, searchParams }: PageProps<"/[lang]/partners/recruitment">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const [occupations, industries, countries, languages, employer, boosts] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getLanguages(),
    isEmployerMember(),
    isReleased("release_boosts"),
  ]);
  const { filters, errors } = parsePartnerSearchParams(rawParams, "recruitment");
  const ignored = Object.values(errors);

  return (
    <PageContainer layout="page" className="grid gap-8">
      <PageHeader title="Find recruitment partners" className="animate-rise">
        <p className="text-body text-muted-foreground">
          Recruitment companies that recruit for your country and occupations. Results are ordered by the filters they match
          and by how recently they updated their profile; no company pays to rank higher.{" "}
          <TextLink href={`/${lang}/${RANKING_PATH}`}>How results are ranked</TextLink>
        </p>
      </PageHeader>

      {employer ? <AvailableWorkforceSearch lang={lang} occupations={occupations} countries={countries} /> : null}

      {ignored.length > 0 ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Some search options were ignored</p>
          <ul className="list-disc ps-5">
            {ignored.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <PartnerSearchForm
        lang={lang}
        kind="recruitment"
        query={partnerSearchQuery({ ...filters, cursor: undefined })}
        occupations={occupations}
        industries={industries}
        countries={countries}
        languages={languages}
        advancedOpen={usesAdvancedFilters(filters)}
      />
      {boosts ? (
        <Suspense key={`boosted-${partnerSearchQuery({ ...filters, cursor: undefined })}`} fallback={null}>
          <BoostedRail lang={lang} kind="recruitment" filters={filters} />
        </Suspense>
      ) : null}
      <Suspense key={partnerSearchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <PartnerResults lang={lang} kind="recruitment" filters={filters} />
      </Suspense>
    </PageContainer>
  );
}
