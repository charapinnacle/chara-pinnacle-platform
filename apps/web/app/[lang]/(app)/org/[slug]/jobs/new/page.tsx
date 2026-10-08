import type { Metadata } from "next";
import { SuspendedOrganization } from "@/components/applicants/suspended-organization";
import { TextLink } from "@/components/forms/text-link";
import { JobForm } from "@/components/jobs/job-form";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
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
    <div className="mx-auto grid w-full max-w-2xl gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">New vacancy</h1>
        <p className="text-body text-muted-foreground">
          {organization.displayName}. The vacancy is saved as a draft and is not public.
        </p>
      </header>
      <JobForm slug={slug} occupations={occupations} industries={industries} countries={countries} currencies={currencies} />
      <TextLink standalone href={jobsPath(lang, slug)}>
        Back to vacancies
      </TextLink>
    </div>
  );
}
