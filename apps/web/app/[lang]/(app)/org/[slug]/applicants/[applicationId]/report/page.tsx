import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ReportForm } from "@/components/reports/report-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getApplicant } from "@/lib/dal/applicants";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { applicantPath, applicantsPath, homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Report a profile", robots: { index: false } };

// A member reports an applicant of the organisation (FR-F4). What Trust & Safety receive is the vacancy applied to, the
// organisation and the text below: not the name of the candidate, and no document.
export default async function ReportApplicantPage({ params }: PageProps<"/[lang]/org/[slug]/applicants/[applicationId]/report">) {
  const { lang, slug, applicationId } = await params;
  const user = await requireUser(lang);
  if (user.accountKind === "worker") redirect(homePath(lang, user.accountKind));
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization />;
  const id = z.uuid().safeParse(applicationId);
  if (!id.success) notFound();
  const applicant = await getApplicant(id.data);
  if (!applicant || applicant.organizationId !== organization.id) notFound();

  return (
    <div className="grid w-full max-w-3xl gap-page">
      <PageHeader
        title="Report this profile"
        description="Trust & Safety receive the vacancy, your organisation and what you write here. They do not receive the name of the candidate or any document."
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Applicants", href: applicantsPath(lang, slug, { job: applicant.jobId }) },
              { label: "Applicant", href: applicantPath(lang, slug, applicant.id) },
              { label: "Report" },
            ]}
          />
        }
      >
        <p className="text-body font-medium wrap-anywhere">{applicant.jobTitle}</p>
      </PageHeader>
      <ReportForm lang={lang} type="profile" target={applicant.id} signedIn />
    </div>
  );
}
