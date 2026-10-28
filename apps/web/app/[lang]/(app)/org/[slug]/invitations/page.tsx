import type { Metadata } from "next";
import Link from "next/link";
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
import { cn } from "@/lib/utils";

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
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Invitations"
        description="Workforce requirements employers invited your company to, newest first. Open one to read it and accept or decline."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Invitations" }]} />}
      />
      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {filters.map((status) => {
            const current = status === inbox.status;
            return (
              <li key={status ?? "all"}>
                <Link
                  href={invitationsPath(lang, slug, inboxQuery({ status, cursor: null }))}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-4 text-small font-medium transition-colors duration-150 hover:bg-secondary",
                    current && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {status ? partnerStatusLabels[status] : "All"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
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
