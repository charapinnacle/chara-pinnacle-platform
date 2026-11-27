import { TabLinks } from "@/components/layout/tab-links";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { InvitationInbox } from "@/components/invitations/invitation-inbox";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { inboxQuery, invitationStatuses, parseInboxParams, partnerStatusLabels } from "@/lib/invitations/presentation";
import { invitationsPath } from "@/lib/routes";
import { JobOrderTabs } from "@/components/layout/section-tabs";

export const metadata: Metadata = { title: "Invitations", robots: { index: false } };

// The invitations of a recruitment or staffing company (FR-O1 AC8), for every member while release 2b is on, rendered
// per request: the address holds the status filter and the page. A partner that was never invited sees an empty list
// and nothing of any requirement (NFR-S11).
export default async function InvitationsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/invitations">) {
  const [{ lang, slug }, raw] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Invitations" subject="invitations" />;
  const inbox = parseInboxParams(raw);
  const countries = await getCountries();
  const filters = [null, ...invitationStatuses] as const;

  return (
    <div className="grid w-full gap-section">
      <PageHeader
        title="Invitations"
        description="Workforce requirements employers invited your company to, newest first. Open one to read it and accept or decline."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Invitations" }]} />}
      />
      <JobOrderTabs lang={lang} slug={slug} current="invitations" />
      <TabLinks
        label="Filter by status"
        items={filters.map((status) => ({
          key: status ?? "all",
          href: invitationsPath(lang, slug, inboxQuery({ status, cursor: null })),
          label: status ? partnerStatusLabels[status] : "All",
          current: status === inbox.status,
        }))}
      />
      <Suspense key={inboxQuery(inbox)} fallback={<LoadingSkeleton rows={4} />}>
        <InvitationInbox
          lang={lang}
          slug={slug}
          organizationId={organization.id}
          params={inbox}
          countries={new Map(countries.map(({ code, name }) => [code, name]))}
        />
      </Suspense>
    </div>
  );
}
