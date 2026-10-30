import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { MyResponseList } from "@/components/responses/my-response-list";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Responses", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The responses a recruitment or staffing company sent (FR-O2 pages, NFR-U4), for every member while release 2b is on,
// rendered per request with the page in the address.
export default async function ResponsesPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/responses">) {
  const [{ lang, slug }, raw] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Responses" subject="responses" />;
  const cursor = typeof raw.cursor === "string" && UUID.test(raw.cursor) ? raw.cursor : null;
  const countries = await getCountries();

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Responses"
        description="The responses your company sent to job orders and invitations, newest first. Open one to read, change or withdraw it."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Responses" }]} />}
      />
      <Suspense key={cursor ?? "first"} fallback={<LoadingSkeleton rows={4} />}>
        <MyResponseList
          lang={lang}
          slug={slug}
          organizationId={organization.id}
          cursor={cursor}
          countries={new Map(countries.map(({ code, name }) => [code, name]))}
        />
      </Suspense>
    </div>
  );
}
