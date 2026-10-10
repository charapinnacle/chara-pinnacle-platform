import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { JobForm } from "@/components/jobs/job-form";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
import { organizationCrumb } from "@/lib/app/navigation";
import { requireOrgRole } from "@/lib/dal/session";
import { jobsPath } from "@/lib/routes";

export const metadata: Metadata = { title: "New vacancy — CHARA", robots: { index: false } };

export default async function NewJobPage({ params }: PageProps<"/[lang]/org/[slug]/jobs/new">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin", { mfa: false, hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="New vacancy" subject="vacancies" />;
  const [occupations, industries, countries, currencies] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getCurrencies(),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-section">
      <PageHeader
        title="New vacancy"
        description={`${organization.displayName}. The vacancy is saved as a draft and is not public.`}
        breadcrumb={
          <Breadcrumbs
            items={[organizationCrumb(lang, organization), { label: "Vacancies", href: jobsPath(lang, slug) }, { label: "New vacancy" }]}
          />
        }
      />
      <JobForm slug={slug} occupations={occupations} industries={industries} countries={countries} currencies={currencies} />
    </div>
  );
}
