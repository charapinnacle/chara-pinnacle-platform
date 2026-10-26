import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { PartnerResults } from "@/components/partners/partner-results";
import { PartnerSearchForm } from "@/components/partners/partner-search-form";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { parsePartnerSearchParams, partnerSearchQuery, usesAdvancedFilters } from "@/lib/partners/search-params";
import { partnerDirectoryMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/partners/recruitment">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_partner_directories")) ? partnerDirectoryMetadata(lang) : {};
}

// The directory of recruitment companies (FR-L1), rendered per request: the address holds the filters and the page
// cursor, so a search can be shared and Back restores it. Nothing is shown while release 2a is off.
export default async function RecruitmentPartnersPage({ params, searchParams }: PageProps<"/[lang]/partners/recruitment">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const [occupations, industries, countries, languages] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getLanguages(),
  ]);
  const { filters, errors } = parsePartnerSearchParams(rawParams, "recruitment");
  const ignored = Object.values(errors);

  return (
    <PageContainer layout="page" className="grid gap-8">
      <PageHeader title="Find Recruitment Partners" className="animate-rise">
        <p className="text-body text-muted-foreground">
          Recruitment companies that recruit for your country and occupations. Results are ordered by the filters they match
          and by how recently they updated their profile; no company pays to rank higher.
        </p>
      </PageHeader>

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
      <Suspense key={partnerSearchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <PartnerResults lang={lang} kind="recruitment" filters={filters} />
      </Suspense>
    </PageContainer>
  );
}
