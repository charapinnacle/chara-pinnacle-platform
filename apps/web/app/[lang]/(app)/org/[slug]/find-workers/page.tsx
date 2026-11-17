import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { FindWorkersFilterForm } from "@/components/find-workers/find-workers-filter-form";
import { FindWorkersRefusalNotice, FindWorkersResults, SavedWorkers, type FindWorkersContext } from "@/components/find-workers/find-workers-results";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { partnerSegments } from "@/lib/dashboard/partner-dashboard";
import { listOpenVacancies } from "@/lib/dal/contact-requests";
import { getWorkerSearchAccess } from "@/lib/dal/find-workers";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getRequirement } from "@/lib/dal/requirements";
import { getCurrentUser, requireOrgRole } from "@/lib/dal/session";
import { findWorkersQuery, parseFindWorkersParams } from "@/lib/find-workers/search-params";
import { RANKING_PATH } from "@/lib/public/navigation";
import { billingPath, requirementPath } from "@/lib/routes";

// No worker is named in the title or anywhere in the metadata (NFR-S9).
export const metadata: Metadata = { title: "Find workers", robots: { index: false } };

const toRecord = (items: readonly { code: string; name: string }[]) => Object.fromEntries(items.map(({ code, name }) => [code, name]));

// Find Workers of an employer or a recruitment or staffing company (FR-Q2, SOP P2-31), rendered per request while release
// 2c is on: the address holds the filters, the page cursor and the requirement the search was opened from. Every member
// of an organisation on a paid plan searches; what each card shows is decided by search_workers alone (the pseudonymous
// card, never a name, photo, contact detail or document, NFR-S9), and the plan decides the filters, never the order.
export default async function FindWorkersPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/find-workers">) {
  const [{ lang, slug }, rawParams] = await Promise.all([params, searchParams]);
  const [released, directories] = await Promise.all([isReleased("release_find_workers"), isReleased("release_partner_directories")]);
  // A visitor is not sent to sign in: the page does not exist for anyone outside the organisation (FR-Q2 AC11).
  if (!released || !(await getCurrentUser())) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: "either" });
  if (organization.suspended) return <SuspendedOrganization title="Find workers" subject="Find Workers" />;
  const canManage = organization.role !== "member";
  const { filters, errors } = parseFindWorkersParams(rawParams);
  const [access, occupations, industries, countries, languages, requirement, vacancies] = await Promise.all([
    getWorkerSearchAccess(organization.id),
    getOccupations(),
    getIndustries(),
    getCountries(),
    getLanguages(),
    filters.requirement && organization.type === "employer" ? getRequirement(organization.id, filters.requirement) : null,
    organization.type === "employer" ? listOpenVacancies(organization.id) : [],
  ]);
  const forRequirement = requirement && requirement.status !== "closed" && requirement.status !== "filled" ? requirement : null;
  if (!forRequirement) filters.requirement = undefined;
  const ignored = Object.values(errors);
  const names = {
    countries: toRecord(countries),
    industries: toRecord(industries),
    languages: toRecord(languages),
    occupations: Object.fromEntries(occupations.map(({ code, label }) => [code, label])),
  };
  const context: FindWorkersContext = {
    lang,
    slug,
    names,
    canManage,
    partnerSegment: organization.type === "employer" ? null : partnerSegments[organization.type],
    requirementId: forRequirement?.id ?? null,
    vacancies,
  };

  return (
    <div className="grid w-full max-w-5xl gap-section">
      <PageHeader title="Find workers" breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Find workers" }]} />}>
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Workers who chose to be found by companies. Cards show what a worker does, where they live and want to work, and when
          they are available, never their name, photo or contact details.
          {directories ? (
            <>
              {" "}
              <TextLink href={`/${lang}/${RANKING_PATH}`}>How results are ordered</TextLink>
            </>
          ) : null}
        </p>
      </PageHeader>

      {access.state === "refused" ? (
        <FindWorkersRefusalNotice reason={access.reason} context={context} />
      ) : (
        <>
          {forRequirement ? (
            <Notice tone="info">
              <p>
                Searching for the requirement{" "}
                <TextLink href={requirementPath(lang, slug, forRequirement.id)}>{forRequirement.title}</TextLink>. Cards you save are kept
                with it.
              </p>
            </Notice>
          ) : null}
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
          <FindWorkersFilterForm
            lang={lang}
            slug={slug}
            query={findWorkersQuery({ ...filters, cursor: undefined })}
            requirementId={context.requirementId}
            advanced={access.advanced}
            plansHref={canManage ? billingPath(lang, slug) : `/${lang}/pricing`}
            occupations={occupations}
            industries={industries}
            countries={countries}
            languages={languages}
          />
          <Suspense key={findWorkersQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
            <FindWorkersResults organizationId={organization.id} filters={filters} context={context} languages={names.languages} />
          </Suspense>
          <Suspense fallback={<LoadingSkeleton rows={2} />}>
            <SavedWorkers organizationId={organization.id} context={context} />
          </Suspense>
        </>
      )}
    </div>
  );
}
