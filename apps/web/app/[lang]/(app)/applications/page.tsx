import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { StageFilter } from "@/components/applications/stage-filter";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { applicationStatusLabels, applicationStatusTones } from "@/lib/applications/presentation";
import { logTrackerView } from "@/lib/applications/tracker-log";
import { listMyApplications } from "@/lib/dal/applications";
import { requireCandidate } from "@/lib/dal/session";
import { formatShortDate } from "@/lib/i18n/format";
import { applicationPath, applicationsPath } from "@/lib/routes";
import { parseApplicationListParams } from "@/lib/validation/application";

export const metadata: Metadata = { title: "My applications — CHARA", robots: { index: false } };

export default async function ApplicationsPage({ params, searchParams }: PageProps<"/[lang]/applications">) {
  const { lang } = await params;
  await requireCandidate(lang);

  const { stage, page } = parseApplicationListParams(await searchParams);
  const { applications, hasNext } = await listMyApplications(stage, page);
  const firstUse = applications.length === 0 && !stage && page === 1;
  logTrackerView("list");

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title="My applications" description="The vacancies you applied to, with the latest change first." />
      {firstUse ? null : <StageFilter basePath={applicationsPath(lang)} stage={stage} />}
      {applications.length === 0 ? (
        firstUse ? (
          <EmptyState
            icon={FileText}
            title="You have not applied to any vacancy yet"
            description="Applications you send appear here with their stage."
          >
            <TextLink standalone href={`/${lang}/jobs`}>
              Find vacancies
            </TextLink>
          </EmptyState>
        ) : page > 1 ? (
          <EmptyState icon={FileText} title="No more applications on this page">
            <TextLink standalone href={applicationsPath(lang, { stage })}>
              Back to the first page
            </TextLink>
          </EmptyState>
        ) : (
          <EmptyState icon={FileText} title="No applications in this stage">
            <form action={applicationsPath(lang)}>
              <FormButton type="submit" variant="secondary" className="w-auto">
                Clear filter
              </FormButton>
            </form>
          </EmptyState>
        )
      ) : (
        <div className="grid gap-4">
          <ul className="grid gap-3">
            {applications.map((application) => (
              <Card as="li" key={application.id} className="gap-2">
                <h2 className="text-h2">
                  <TextLink href={applicationPath(lang, application.id)} className="wrap-anywhere">
                    {application.jobTitle}
                  </TextLink>
                </h2>
                <p className="font-medium wrap-anywhere">{application.employerName}</p>
                <p>
                  <StatusBadge status={applicationStatusTones[application.status]}>{applicationStatusLabels[application.status]}</StatusBadge>
                </p>
                <p className="text-small text-muted-foreground">
                  Applied <time dateTime={application.appliedAt}>{formatShortDate(application.appliedAt)}</time>
                  {" · "}Last update <time dateTime={application.lastEventAt}>{formatShortDate(application.lastEventAt)}</time>
                </p>
              </Card>
            ))}
          </ul>
          {page > 1 || hasNext ? (
            <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-6">
              {page > 1 ? (
                <TextLink standalone rel="prev" href={applicationsPath(lang, { stage, page: page - 1 })}>
                  Previous page
                </TextLink>
              ) : null}
              <span className="text-body text-muted-foreground">Page {page}</span>
              {hasNext ? (
                <TextLink standalone rel="next" href={applicationsPath(lang, { stage, page: page + 1 })}>
                  Next page
                </TextLink>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
