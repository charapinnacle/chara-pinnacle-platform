import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { ReadOnlyPlanNotice } from "@/components/billing/read-only-plan";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { COMPLAINTS_SLUG, LegalLink, TextLink } from "@/components/forms/text-link";
import { isSubscriptionEnded, listJobs } from "@/lib/dal/hiring";
import { requireOrgRole } from "@/lib/dal/session";
import { billingPath, jobPath, jobsPath } from "@/lib/routes";
import { STALE_OPEN_TEXT } from "@/lib/jobs/lifecycle";
import { isJobStatus, jobDateText, jobStatusText, jobStatusTone, statusLabels } from "@/lib/jobs/presentation";
import { parseJobCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Vacancies — CHARA", robots: { index: false } };

export default async function JobsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/jobs">) {
  const [{ lang, slug }, { after, status: statusParam }] = await Promise.all([params, searchParams]);
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="Vacancies" subject="vacancies" />;
  const cursor = parseJobCursor(after);
  const status = isJobStatus(statusParam) ? statusParam : null;
  const [page, ended] = await Promise.all([listJobs(organization.id, cursor, status), isSubscriptionEnded(organization.id)]);
  const canCreate = organization.role !== "member";
  const newJob = canCreate ? (
    <TextLink standalone href={`${jobsPath(lang, slug)}/new`}>
      Create vacancy
    </TextLink>
  ) : null;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <PageHeader title="Vacancies" description={organization.displayName} actions={page.jobs.length > 0 ? newJob : null} />

      <ReadOnlyPlanNotice ended={ended} billingHref={organization.role === "member" ? null : billingPath(lang, slug)} />

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
            <Card as="li" key={job.id} className="gap-1">
              <TextLink href={jobPath(lang, slug, job.id)} className="break-words">
                {job.title}
              </TextLink>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
                <StatusBadge status={jobStatusTone(job.status, job.moderationState)}>
                  {jobStatusText(job.status, job.moderationState)}
                </StatusBadge>
                <span>
                  {job.city}, {job.country} · {jobDateText(job)}
                </span>
                {job.staleOpen ? <span className="font-medium text-foreground">{STALE_OPEN_TEXT}</span> : null}
                {job.moderationState === "hidden" ? (
                  <LegalLink slug={COMPLAINTS_SLUG} newTabLabel="(opens in a new tab)">
                    How to appeal
                  </LegalLink>
                ) : null}
              </p>
            </Card>
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
