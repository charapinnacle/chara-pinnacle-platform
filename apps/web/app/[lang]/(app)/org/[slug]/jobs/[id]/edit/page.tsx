import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { COMPLAINTS_SLUG, LegalLink, TextLink } from "@/components/forms/text-link";
import { Notice } from "@/components/forms/notice";
import { JobForm } from "@/components/jobs/job-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getJob, toJobFormInput } from "@/lib/dal/hiring";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
import { requireOrgRole } from "@/lib/dal/session";
import { isEditable } from "@/lib/jobs/lifecycle";
import { jobStatusText } from "@/lib/jobs/presentation";
import { jobPath, jobsPath } from "@/lib/routes";
import { jobIdSchema } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Edit vacancy — CHARA", robots: { index: false } };

// Owners and admins correct a vacancy with the form it was created with, in any status but Filled, which is final (FR-C2);
// a member is sent to the forbidden page, as on the new-vacancy page. Saving changes the text only: the status and the
// moderation state stay as they are.
export default async function EditJobPage({ params }: PageProps<"/[lang]/org/[slug]/jobs/[id]/edit">) {
  const { lang, slug, id } = await params;
  const { organization } = await requireOrgRole(lang, slug, "admin", { mfa: false, hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="Edit vacancy" subject="vacancies" />;
  const parsedId = jobIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [job, occupations, industries, countries, currencies] = await Promise.all([
    getJob(organization.id, parsedId.data),
    getOccupations(),
    getIndustries(),
    getCountries(),
    getCurrencies(),
  ]);
  if (!job) notFound();
  const jobHref = jobPath(lang, slug, job.id);
  const isPublic = job.status === "open" && job.moderationState === "visible";
  const editable = isEditable(job.status);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Edit vacancy"
        description={
          editable
            ? `${job.title}. Status: ${jobStatusText(job.status, job.moderationState)}. Saving keeps the status${isPublic ? ", and the public page shows the changes at once" : ""}.`
            : job.title
        }
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Vacancies", href: jobsPath(lang, slug) },
              { label: job.title, href: jobHref },
              { label: "Edit" },
            ]}
          />
        }
      />
      {!editable ? (
        <Notice tone="info" role="status">
          This vacancy is filled. A filled vacancy is final, so it can no longer be changed.
        </Notice>
      ) : job.moderationState === "hidden" ? (
        <Notice tone="info" role="status">
          Our moderators hid this vacancy. Saving your changes does not make it public again; to appeal, follow the route on the{" "}
          <LegalLink slug={COMPLAINTS_SLUG} newTabLabel="(opens in a new tab)">
            Complaints and Dispute Process
          </LegalLink>{" "}
          page.
        </Notice>
      ) : null}
      {editable ? (
        <JobForm
          slug={slug}
          occupations={occupations}
          industries={industries}
          countries={countries}
          currencies={currencies}
          edit={{ jobId: job.id, values: toJobFormInput(job), jobHref }}
        />
      ) : null}
      <TextLink standalone href={jobHref}>
        {editable ? "Cancel and go back to the vacancy" : "Go back to the vacancy"}
      </TextLink>
    </div>
  );
}
