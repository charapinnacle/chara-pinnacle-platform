import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { FindEmployersFilterForm } from "@/components/find-employers/find-employers-filter-form";
import { FindEmployersRefusalNotice, FindEmployersResults, SavedSearches } from "@/components/find-employers/find-employers-results";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { getEmployerSearchAccess } from "@/lib/dal/find-employers";
import { getCountries, getIndustries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { findEmployersQuery, parseFindEmployersParams } from "@/lib/find-employers/search-params";
import { RANKING_PATH } from "@/lib/public/navigation";
import { billingPath } from "@/lib/routes";

// No employer is named in the title or anywhere in the metadata (NFR-S11).
export const metadata: Metadata = { title: "Find employers", robots: { index: false } };

// Find Employers of a recruitment or staffing company (FR-L3, SOP P2-12), rendered per request while release 2b is on:
// the address holds the filters and the page cursor. Every member of a listed partner on a paid plan searches; what each
// result shows is decided by search_employers alone, and the plan decides the filters, never the order.
export default async function FindEmployersPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/find-employers">) {
  const [{ lang, slug }, rawParams] = await Promise.all([params, searchParams]);
  const [released, directories] = await Promise.all([isReleased("release_job_orders"), isReleased("release_partner_directories")]);
  if (!released) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Find employers" subject="Find Employers" />;
  const canManage = organization.role !== "member";
  const [access, occupations, industries, countries] = await Promise.all([
    getEmployerSearchAccess(organization.id),
    getOccupations(),
    getIndustries(),
    getCountries(),
  ]);
  const { filters, errors } = parseFindEmployersParams(rawParams);
  const ignored = Object.values(errors);
  const names = {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
    occupations: new Map(occupations.map(({ code, label }) => [code, label])),
  };
  const context = { lang, slug, names, canManage };

  return (
    <div className="grid w-full gap-section">
      <PageHeader title="Find employers" breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Find employers" }]} />}>
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Employers with a public company page, and the open job orders you can supply, newest activity first. Where an
          employer chose not to be named, its job order is listed on its own as “Company not named”.
          {directories ? (
            <>
              {" "}
              <TextLink href={`/${lang}/${RANKING_PATH}`}>How results are ordered</TextLink>
            </>
          ) : null}
        </p>
      </PageHeader>

      {access.state === "refused" ? (
        <FindEmployersRefusalNotice reason={access.reason} context={context} />
      ) : (
        <>
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
          <FindEmployersFilterForm
            lang={lang}
            slug={slug}
            query={findEmployersQuery({ ...filters, cursor: undefined })}
            advanced={access.advanced}
            plansHref={canManage ? billingPath(lang, slug) : `/${lang}/pricing`}
            occupations={occupations}
            industries={industries}
            countries={countries}
          />
          {access.advanced ? (
            <Suspense fallback={<LoadingSkeleton rows={2} />}>
              <SavedSearches lang={lang} slug={slug} organizationId={organization.id} names={names} />
            </Suspense>
          ) : null}
          <Suspense key={findEmployersQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
            <FindEmployersResults
              lang={lang}
              slug={slug}
              organizationId={organization.id}
              filters={filters}
              names={names}
              canManage={canManage}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
