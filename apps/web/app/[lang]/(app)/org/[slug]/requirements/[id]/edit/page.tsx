import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getRequirement, toRequirementFormInput } from "@/lib/dal/requirements";
import { requireOrgRole } from "@/lib/dal/session";
import { isRequirementEditable } from "@/lib/requirements/presentation";
import { requirementPath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Edit workforce requirement", robots: { index: false } };

// Owners and admins at aal2 correct a requirement with the form it was created with, in any status but Closed and
// Filled, which are final; saving keeps the status.
export default async function EditRequirementPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/edit">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { user, organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Edit workforce requirement" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [requirement, occupations, industries, countries, currencies] = await Promise.all([
    getRequirement(organization.id, parsedId.data),
    getOccupations(),
    getIndustries(),
    getCountries(),
    getCurrencies(),
  ]);
  if (!requirement) notFound();
  const requirementHref = requirementPath(lang, slug, requirement.id);
  const editable = isRequirementEditable(requirement.status);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Edit workforce requirement"
        description={editable ? `${requirement.title}. Saving keeps the status.` : requirement.title}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: requirement.title, href: requirementHref },
              { label: "Edit" },
            ]}
          />
        }
      />
      {editable ? (
        <RequirementForm
          slug={slug}
          userId={user.id}
          occupations={occupations}
          industries={industries}
          countries={countries}
          currencies={currencies}
          edit={{ requirementId: requirement.id, values: toRequirementFormInput(requirement), expectedUpdatedAt: requirement.updatedAt }}
        />
      ) : (
        <Notice tone="info" role="status">
          This workforce requirement is closed or filled, so it can no longer be changed.
        </Notice>
      )}
      <TextLink standalone href={requirementHref}>
        {editable ? "Cancel and go back to the workforce requirement" : "Go back to the workforce requirement"}
      </TextLink>
    </div>
  );
}
