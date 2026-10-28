import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { JobOrderFilterForm } from "@/components/job-orders/job-order-filter-form";
import { JobOrderResults } from "@/components/job-orders/job-order-results";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCountries, getIndustries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { jobOrderQuery, parseJobOrderParams } from "@/lib/job-orders/search-params";
import { RANKING_PATH } from "@/lib/public/navigation";
import { notificationSettingsPath } from "@/lib/routes";

// No employer is named in the title or anywhere in the metadata of the marketplace (NFR-S11).
export const metadata: Metadata = { title: "Job orders", robots: { index: false } };

// The job order marketplace of a recruitment or staffing company (FR-N1, SOP P2-19), rendered per request while release
// 2b is on: the address holds the filters and the page cursor, so a search can be shared and Back restores it. Every
// member of a listed partner reads it; what each job order shows is decided by list_job_orders alone.
export default async function JobOrdersPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/job-orders">) {
  const [{ lang, slug }, rawParams] = await Promise.all([params, searchParams]);
  const [jobOrders, directories] = await Promise.all([isReleased("release_job_orders"), isReleased("release_partner_directories")]);
  if (!jobOrders) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Job orders" subject="job orders" />;
  const [occupations, industries, countries] = await Promise.all([getOccupations(), getIndustries(), getCountries()]);
  const { filters, errors } = parseJobOrderParams(rawParams);
  const ignored = Object.values(errors);
  const names = {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
  };

  return (
    <div className="grid w-full max-w-5xl gap-section">
      <PageHeader title="Job orders" breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Job orders" }]} />}>
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Workforce requirements that employers published for recruitment and staffing companies, newest first. Job orders
          that fit the countries you serve and the occupations you list are shown in full on a paid plan; the others show
          their title.
          {directories ? (
            <>
              {" "}
              <TextLink href={`/${lang}/${RANKING_PATH}`}>How job orders are ordered</TextLink>
            </>
          ) : null}
        </p>
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Get an email when a new job order fits your company:{" "}
          <TextLink href={notificationSettingsPath(lang, slug)}>switch on New job orders that fit</TextLink>.
        </p>
      </PageHeader>

      {ignored.length > 0 ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Some filters were ignored</p>
          <ul className="list-disc ps-5">
            {ignored.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <JobOrderFilterForm
        lang={lang}
        slug={slug}
        query={jobOrderQuery({ ...filters, cursor: undefined })}
        occupations={occupations}
        industries={industries}
        countries={countries}
      />
      <Suspense key={jobOrderQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <JobOrderResults
          lang={lang}
          slug={slug}
          organizationId={organization.id}
          filters={filters}
          names={names}
          canManage={organization.role !== "member"}
        />
      </Suspense>
    </div>
  );
}
