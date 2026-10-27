import type { Metadata } from "next";
import { ClipboardList, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementUsage } from "@/components/requirements/requirement-usage";
import { organizationCrumb } from "@/lib/app/navigation";
import { isReleased } from "@/lib/dal/release";
import { listRequirements } from "@/lib/dal/requirements";
import { getUsagePrompts } from "@/lib/dal/usage";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { isRequirementEditable, requirementStatusLabels, requirementStatusTones, workersText } from "@/lib/requirements/presentation";
import { ACTIVE_REQUIREMENTS } from "@/lib/requirements/limits";
import { billingPath, requirementPath, requirementsPath } from "@/lib/routes";
import { parseJobCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Workforce requirements", robots: { index: false } };

// The workforce requirements of an employer (FR-M1), newest first; members read them, owners and admins at aal2 create
// and edit. A recruitment or staffing company gets the same answer as an outsider. Nothing is shown while release 2b is
// off.
export default async function RequirementsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/requirements">) {
  const [{ lang, slug }, { after }] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Workforce requirements" subject="workforce requirements" />;

  const cursor = parseJobCursor(after);
  const [{ requirements, nextCursor }, prompts] = await Promise.all([
    listRequirements(organization.id, cursor),
    getUsagePrompts(organization.id, "employer", [ACTIVE_REQUIREMENTS]),
  ]);
  const canCreate = organization.role !== "member";
  const newRequirement = canCreate ? (
    <LinkButton href={`${requirementsPath(lang, slug)}/new`} size="default" className="gap-2">
      <Plus aria-hidden className="size-4" />
      Post workforce requirement
    </LinkButton>
  ) : null;

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Workforce requirements"
        description={`${organization.displayName}. Describe a need for a group of workers once; candidates do not apply to it.`}
        actions={requirements.length > 0 ? newRequirement : null}
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Workforce requirements" }]} />}
      />

      <RequirementUsage
        organizationId={organization.id}
        prompt={prompts[ACTIVE_REQUIREMENTS]}
        billingHref={billingPath(lang, slug)}
        canUpgrade={canCreate}
      />

      {requirements.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No workforce requirements yet"
          description={
            canCreate
              ? "Post a requirement for a group of workers. It is saved as a draft and is not visible to partners."
              : "An owner or admin posts the workforce requirements of your company."
          }
        >
          {newRequirement}
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {requirements.map((requirement) => (
            <Card as="li" key={requirement.id} className="gap-1">
              <TextLink href={requirementPath(lang, slug, requirement.id)} className="break-words">
                {requirement.title}
              </TextLink>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
                <StatusBadge status={requirementStatusTones[requirement.status]}>{requirementStatusLabels[requirement.status]}</StatusBadge>
                <span>
                  {workersText(requirement.workersNeeded)} · {requirement.cityRegion}, {requirement.country} · Created{" "}
                  {formatDate(requirement.createdAt)}
                </span>
                {canCreate && isRequirementEditable(requirement.status) ? (
                  <TextLink href={`${requirementPath(lang, slug, requirement.id)}/edit`}>
                    Edit<span className="sr-only"> {requirement.title}</span>
                  </TextLink>
                ) : null}
              </p>
            </Card>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <TextLink standalone href={requirementsPath(lang, slug, nextCursor)}>
          Show more workforce requirements
        </TextLink>
      ) : null}
      {cursor ? (
        <TextLink standalone href={requirementsPath(lang, slug)}>
          Back to the newest workforce requirements
        </TextLink>
      ) : null}
    </div>
  );
}
