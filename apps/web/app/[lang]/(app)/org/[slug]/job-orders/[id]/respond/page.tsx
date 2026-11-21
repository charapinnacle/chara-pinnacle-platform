import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { EligibilityError } from "@/components/responses/eligibility-error";
import { RespondSection } from "@/components/responses/respond-section";
import { organizationCrumb } from "@/lib/app/navigation";
import { getJobOrder } from "@/lib/dal/job-orders";
import { isReleased } from "@/lib/dal/release";
import { getResponseEligibility } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { jobOrderPath, jobOrderRespondPath, jobOrdersPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

// Like the job order page, nothing of the requirement or the employer leaves the page in its metadata (NFR-S11).
export const metadata: Metadata = { title: "Respond to a job order", robots: { index: false } };

// The response form for a job order of the marketplace (FR-N2 step Respond, FR-O2), for every member of a listed
// recruitment or staffing company while release 2b is on. A job order the partner may not see ends in the neutral 404.
export default async function RespondToJobOrderPage({ params }: PageProps<"/[lang]/org/[slug]/job-orders/[id]/respond">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Respond to a job order" subject="job orders" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const result = await getJobOrder(organization.id, parsedId.data);
  if (result.state !== "found" || !result.order.eligible) notFound();
  const { order } = result;
  const eligibility = await getResponseEligibility(organization.id, order.id).catch(() => "failed" as const);
  if (eligibility === null) notFound();

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Respond to this job order"
        description={order.title}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Job orders", href: jobOrdersPath(lang, slug) },
              { label: order.title, href: jobOrderPath(lang, slug, order.id) },
              { label: "Respond" },
            ]}
          />
        }
      />
      {eligibility === "failed" ? (
        <EligibilityError />
      ) : (
        <RespondSection
          lang={lang}
          slug={slug}
          organization={organization}
          requirement={{ id: order.id, workersNeeded: order.workersNeeded, countryCode: order.countryCode, salaryCurrency: order.salaryCurrency }}
          eligibility={eligibility}
          selfHref={jobOrderRespondPath(lang, slug, order.id)}
        />
      )}
    </div>
  );
}
