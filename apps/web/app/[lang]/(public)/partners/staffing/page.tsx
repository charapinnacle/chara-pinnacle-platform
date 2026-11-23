import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgencyWorkNotice } from "@/components/compliance/agency-work-notice";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AvailableWorkforceSearch } from "@/components/partners/available-workforce-search";
import { PartnerResults } from "@/components/partners/partner-results";
import { PartnerSearchForm } from "@/components/partners/partner-search-form";
import { agencyWorkRulesFor } from "@/lib/compliance/agency-work";
import { isEmployerMember } from "@/lib/dal/organizations";
import { getAgencyWorkRules, getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { parsePartnerSearchParams, partnerSearchQuery, usesAdvancedFilters } from "@/lib/partners/search-params";
import { RANKING_PATH } from "@/lib/public/navigation";
import { staffingDirectoryMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/partners/staffing">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_partner_directories")) ? staffingDirectoryMetadata(lang) : {};
}

// The directory of staffing partners (FR-L2): staffing companies and recruitment companies that also offer staffing,
// rendered per request with the filters and the page cursor in the address, as the recruitment directory. An employer
// also finds the Available workforce search here (FR-K3). Nothing is shown while release 2a is off.
export default async function StaffingPartnersPage({ params, searchParams }: PageProps<"/[lang]/partners/staffing">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const [occupations, industries, countries, languages, employer, agencyRules] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getLanguages(),
    isEmployerMember(),
    getAgencyWorkRules(),
  ]);
  const { filters, errors } = parsePartnerSearchParams(rawParams, "staffing");
  const ignored = Object.values(errors);

  return (
    <PageContainer layout="page" className="grid gap-8">
      <PageHeader title="Find staffing partners" className="animate-rise">
        <p className="text-body text-muted-foreground">
          Staffing companies, and recruitment companies that also supply staff, for your markets, occupations and staffing
          types. Results are ordered by the filters they match and by how recently they updated their profile; no company
          pays to rank higher. Only availability confirmed in the last weeks is shown.{" "}
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
        kind="staffing"
        query={partnerSearchQuery({ ...filters, cursor: undefined })}
        occupations={occupations}
        industries={industries}
        countries={countries}
        languages={languages}
        advancedOpen={usesAdvancedFilters(filters)}
      />
      <AgencyWorkNotice rules={agencyWorkRulesFor(agencyRules, filters.destination)} />
      <Suspense key={partnerSearchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <PartnerResults lang={lang} kind="staffing" filters={filters} />
      </Suspense>
    </PageContainer>
  );
}
