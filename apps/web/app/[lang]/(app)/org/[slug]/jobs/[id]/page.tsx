import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { Notice } from "@/components/forms/notice";
import { JobStatusActions } from "@/components/jobs/job-status-actions";
import { VacancyView } from "@/components/jobs/vacancy-view";
import { getJob } from "@/lib/dal/hiring";
import { requireOrgRole } from "@/lib/dal/session";
import { STALE_OPEN_TEXT } from "@/lib/jobs/lifecycle";
import { applicantsPath, billingPath, jobPath, jobsPath } from "@/lib/routes";
import { jobDateText, jobStatusText } from "@/lib/jobs/presentation";
import { jobIdSchema } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Vacancy — CHARA", robots: { index: false } };

export default async function JobPage({ params }: PageProps<"/[lang]/org/[slug]/jobs/[id]">) {
  const { lang, slug, id } = await params;
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  const parsedId = jobIdSchema.safeParse(id);
  const job = parsedId.success ? await getJob(organization.id, parsedId.data) : null;
  if (!job) notFound();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Notice tone="info" role="status">
        {jobStatusText(job.status, job.moderationState)}
        {job.staleOpen ? ` · ${STALE_OPEN_TEXT}` : ""}
        {` · ${jobDateText(job)}`}
      </Notice>
      {organization.role === "member" ? null : (
        <JobStatusActions slug={slug} jobId={job.id} status={job.status} billingHref={billingPath(lang, slug)} />
      )}
      <VacancyView job={job} />
      <div className="flex flex-wrap gap-x-6">
        <TextLink standalone href={applicantsPath(lang, slug, { job: job.id })}>
          Applicants
        </TextLink>
        <TextLink standalone href={`${jobPath(lang, slug, job.id)}/preview`}>
          Preview as candidates see it
        </TextLink>
        <TextLink standalone href={jobsPath(lang, slug)}>
          Back to vacancies
        </TextLink>
      </div>
    </div>
  );
}
