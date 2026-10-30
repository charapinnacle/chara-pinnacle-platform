import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementResponseList } from "@/components/responses/requirement-response-list";
import { organizationCrumb } from "@/lib/app/navigation";
import { isReleased } from "@/lib/dal/release";
import { getRequirement } from "@/lib/dal/requirements";
import { listRequirementResponses } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { requirementPath, requirementResponsesComparePath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Responses", robots: { index: false } };

// The responses of partners to one requirement (FR-O2 steps Submit and Edit, AC9; FR-N2 AC9), for every member of the
// employer while release 2b is on: Updated until a changed response is opened, Withdrawn with the date and the reason.
// Compare responses opens the comparison with the decisions (FR-O3), also for a single response (AC11).
export default async function RequirementResponsesPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/responses">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Responses" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const requirement = await getRequirement(organization.id, parsedId.data);
  if (!requirement) notFound();
  const responses = await listRequirementResponses(organization.id, requirement.id);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Responses"
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: requirement.title, href: requirementPath(lang, slug, requirement.id) },
              { label: "Responses" },
            ]}
          />
        }
      >
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          The responses of recruitment and staffing companies to {requirement.title}, oldest first. Open one to read the
          proposal, its documents and what changed.
        </p>
        {responses.some((response) => response.status !== "withdrawn") ? (
          <div className="flex flex-wrap gap-3">
            <LinkButton href={requirementResponsesComparePath(lang, slug, requirement.id)} size="default">
              Compare responses
            </LinkButton>
          </div>
        ) : null}
      </PageHeader>
      <RequirementResponseList lang={lang} slug={slug} requirementId={requirement.id} responses={responses} />
    </div>
  );
}
