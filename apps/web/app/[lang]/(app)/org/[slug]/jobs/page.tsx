import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { listJobs } from "@/lib/dal/hiring";
import { requireOrgRole } from "@/lib/dal/session";
import { jobPath, jobsPath } from "@/lib/routes";
import { STALE_OPEN_TEXT } from "@/lib/jobs/lifecycle";
import { isJobStatus, jobDateText, jobStatusText, statusLabels } from "@/lib/jobs/presentation";
import { parseJobCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Vacancies — CHARA", robots: { index: false } };

export default async function JobsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/jobs">) {
  const [{ lang, slug }, { after, status: statusParam }] = await Promise.all([params, searchParams]);
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  const cursor = parseJobCursor(after);
  const status = isJobStatus(statusParam) ? statusParam : null;
  const page = await listJobs(organization.id, cursor, status);
  const canCreate = organization.role !== "member";
  const newJob = canCreate ? (
    <TextLink standalone href={`${jobsPath(lang, slug)}/new`}>
      Create vacancy
    </TextLink>
  ) : null;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Vacancies</h1>
          <p className="text-body text-muted-foreground">{organization.displayName}</p>
        </div>
        {page.jobs.length > 0 ? newJob : null}
      </header>

      {page.jobs.length === 0 && status ? (
        <EmptyState icon={Briefcase} title={`No ${statusLabels[status].toLowerCase()} vacancies`}>
          <TextLink standalone href={jobsPath(lang, slug)}>
            Show all vacancies
          </TextLink>
        </EmptyState>
      ) : page.jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No vacancies yet"
          description={canCreate ? "Create the first vacancy as a draft and preview it before it goes public." : "An owner or admin creates the vacancies of your company."}
        >
          {newJob}
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {page.jobs.map((job) => (
            <li key={job.id} className="grid gap-1 rounded-xl border bg-card p-4">
              <TextLink href={jobPath(lang, slug, job.id)} className="break-words">
                {job.title}
              </TextLink>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="rounded-full border bg-accent px-2 py-0.5 font-medium text-accent-foreground">
                  {jobStatusText(job.status, job.moderationState)}
                </span>
                <span>
                  {job.city}, {job.country} · {jobDateText(job)}
                </span>
                {job.staleOpen ? <span className="font-medium text-foreground">{STALE_OPEN_TEXT}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <TextLink standalone href={jobsPath(lang, slug, { status, after: page.nextCursor })}>
          Show more vacancies
        </TextLink>
      ) : null}
      {cursor ? (
        <TextLink standalone href={jobsPath(lang, slug, { status })}>
          Back to the newest vacancies
        </TextLink>
      ) : null}
    </div>
  );
}
