import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { PartnerSubmissionList } from "@/components/submissions/partner-submission-list";
import { organizationCrumb } from "@/lib/app/navigation";
import { requireOrgRole } from "@/lib/dal/session";
import { submissionsReleased } from "@/lib/dal/submissions";
import { ResponseTabs } from "@/components/layout/section-tabs";

export const metadata: Metadata = { title: "Submissions", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Every candidate the recruitment or staffing company asked to submit, newest first, for every member while candidate
// submissions are released (FR-O4 AC12, NFR-U4), rendered per request with the page in the address.
export default async function PartnerSubmissionsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/submissions">) {
  const [{ lang, slug }, raw] = await Promise.all([params, searchParams]);
  if (!(await submissionsReleased())) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Submissions" subject="candidate submissions" />;
  const cursor = typeof raw.cursor === "string" && UUID.test(raw.cursor) ? raw.cursor : null;

  return (
    <div className="grid w-full gap-section">
      <PageHeader
        title="Submissions"
        description="The candidates your company asked to submit to employers, newest first. A candidate is submitted only once they approve."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Submissions" }]} />}
      />
      <ResponseTabs lang={lang} slug={slug} current="submissions" submissions />
      <Suspense key={cursor ?? "first"} fallback={<LoadingSkeleton rows={4} />}>
        <PartnerSubmissionList lang={lang} slug={slug} organizationId={organization.id} requirementId={null} cursor={cursor} />
      </Suspense>
    </div>
  );
}
