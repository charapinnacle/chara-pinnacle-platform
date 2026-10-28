import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementInvitations } from "@/components/requirements/requirement-invitations";
import { RequirementPartners } from "@/components/requirements/requirement-partners";
import { RequirementStatusActions } from "@/components/requirements/requirement-status-actions";
import { RequirementStatusNotice } from "@/components/requirements/requirement-status-notice";
import { RequirementVacancies } from "@/components/requirements/requirement-vacancies";
import { RequirementView } from "@/components/requirements/requirement-view";
import { organizationCrumb } from "@/lib/app/navigation";
import { getInvitationUsage } from "@/lib/dal/invitations";
import { isReleased } from "@/lib/dal/release";
import { getRequirement, getRequirementDurations, listRequirementVacancies } from "@/lib/dal/requirements";
import { requireOrgRole } from "@/lib/dal/session";
import { isRequirementEditable } from "@/lib/requirements/presentation";
import { canSuggestPartners } from "@/lib/requirements/suggestions";
import { canCreateVacancies } from "@/lib/requirements/vacancies";
import { billingPath, requirementPath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Workforce requirement", robots: { index: false } };

// One requirement as its organisation reads it, with its status, the date that matters next and, for an owner or admin,
// the status actions (FR-M1 AC1, FR-M2 AC12, NFR-U4), and the vacancies for direct applications copied from it (FR-M1
// AC10), the way to the suggested partners when it needs partners (FR-M3, V36) and, once published, to its invitations
// (FR-O1, V42).
export default async function RequirementPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Workforce requirement" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [requirement, durations, vacancies, directories, usage] = await Promise.all([
    getRequirement(organization.id, parsedId.data),
    getRequirementDurations(),
    listRequirementVacancies(organization.id, parsedId.data).catch(() => null),
    isReleased("release_partner_directories"),
    getInvitationUsage(organization.id, parsedId.data).catch(() => null),
  ]);
  if (!requirement) notFound();
  const manager = organization.role !== "member";
  const today = new Date().toISOString().slice(0, 10);

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
      <RequirementStatusNotice requirement={requirement} today={today} reminderDays={durations.reminderDays} />
      {manager ? (
        <RequirementStatusActions
          organizationId={organization.id}
          slug={slug}
          billingHref={billingPath(lang, slug)}
          target={{ id: requirement.id, expectedUpdatedAt: requirement.updatedAt }}
          status={requirement.status}
          startDate={requirement.startDate}
          today={today}
          openDays={durations.openDays}
          extensionDays={durations.extensionDays}
        />
      ) : null}
      {directories && canSuggestPartners(requirement.status, requirement.partnerNeed) ? (
        <RequirementPartners lang={lang} slug={slug} requirement={requirement} />
      ) : null}
      {requirement.status !== "draft" ? (
        <RequirementInvitations lang={lang} slug={slug} requirementId={requirement.id} usage={usage} />
      ) : null}
      <RequirementVacancies
        lang={lang}
        slug={slug}
        target={{ id: requirement.id, expectedUpdatedAt: requirement.updatedAt }}
        vacancies={vacancies}
        occupations={requirement.occupations.length}
        canCreate={manager && canCreateVacancies(requirement.status)}
        anonymous={requirement.visibility === "job_order_marketplace" && !requirement.showIdentity}
      />
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
