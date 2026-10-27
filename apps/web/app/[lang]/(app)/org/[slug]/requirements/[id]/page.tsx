import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementView } from "@/components/requirements/requirement-view";
import { organizationCrumb } from "@/lib/app/navigation";
import { isReleased } from "@/lib/dal/release";
import { getRequirement } from "@/lib/dal/requirements";
import { requireOrgRole } from "@/lib/dal/session";
import { isRequirementEditable, requirementStatusNotices } from "@/lib/requirements/presentation";
import { requirementPath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Workforce requirement", robots: { index: false } };

// One requirement as its organisation reads it, with its status and what it means for partners (FR-M1 AC1, NFR-U4).
// Publishing and the next steps after it (suggested partners, invitations, linked vacancies) come with V33 to V36.
export default async function RequirementPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Workforce requirement" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const requirement = await getRequirement(organization.id, parsedId.data);
  if (!requirement) notFound();
  const manager = organization.role !== "member";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title={requirement.title}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: requirement.title },
            ]}
          />
        }
      />
      <Notice tone="info" role="status">
        {requirementStatusNotices[requirement.status]}
      </Notice>
      <RequirementView requirement={requirement} />
      {manager && isRequirementEditable(requirement.status) ? (
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`${requirementPath(lang, slug, requirement.id)}/edit`} variant="secondary" size="default">
            Edit workforce requirement
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}
