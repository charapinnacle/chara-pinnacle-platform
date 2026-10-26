import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AvailableWorkforceSearch } from "@/components/partners/available-workforce-search";
import { PartnerResults } from "@/components/partners/partner-results";
import { PartnerSearchForm } from "@/components/partners/partner-search-form";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { parsePartnerSearchParams, partnerSearchQuery, usesAdvancedFilters } from "@/lib/partners/search-params";
import { staffingDirectoryMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/partners/staffing">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_partner_directories")) ? staffingDirectoryMetadata(lang) : {};
}

// Only an employer searches the available workforce (FR-K3); the database checks the plan again.
async function isEmployerMember(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || user.accountKind !== "company") return false;
  return (await getMyOrganizations(user.id)).some(({ type, suspended }) => type === "employer" && !suspended);
}

// The directory of staffing partners (FR-L2): staffing companies and recruitment companies that also offer staffing,
// rendered per request with the filters and the page cursor in the address, as the recruitment directory. An employer
// also finds the Available workforce search here (FR-K3). Nothing is shown while release 2a is off.
export default async function StaffingPartnersPage({ params, searchParams }: PageProps<"/[lang]/partners/staffing">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const [occupations, industries, countries, languages, employer] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getLanguages(),
    isEmployerMember(),
  ]);
  const { filters, errors } = parsePartnerSearchParams(rawParams, "staffing");
  const ignored = Object.values(errors);

  return (
    <PageContainer layout="page" className="grid gap-8">
      <PageHeader title="Find Staffing Partners" className="animate-rise">
        <p className="text-body text-muted-foreground">
          Staffing companies, and recruitment companies that also supply staff, for your markets, occupations and staffing
          types. Results are ordered by the filters they match and by how recently they updated their profile; no company
          pays to rank higher. Only availability confirmed in the last weeks is shown.
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
      <Suspense key={partnerSearchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <PartnerResults lang={lang} kind="staffing" filters={filters} />
      </Suspense>
    </PageContainer>
  );
}
