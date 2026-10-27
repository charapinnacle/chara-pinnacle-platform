import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { requirementsPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Post workforce requirement", robots: { index: false } };

// Owners and admins at aal2 of an employer post a requirement (FR-M1 AC1); a member is sent to the forbidden page, a
// partner or an outsider gets not found. Not served while release 2b is off.
export default async function NewRequirementPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/new">) {
  const { lang, slug } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "admin", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Post workforce requirement" subject="workforce requirements" />;
  const [occupations, industries, countries, currencies] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getCurrencies(),
  ]);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Post workforce requirement"
        description={`${organization.displayName}. The requirement is saved as a draft and is not visible to partners.`}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: "Post workforce requirement" },
            ]}
          />
        }
      />
      <RequirementForm slug={slug} occupations={occupations} industries={industries} countries={countries} currencies={currencies} />
    </div>
  );
}
