import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { WithdrawApplication } from "@/components/applications/withdraw-application";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { applicationNextSteps, applicationStatusLabels, eventActorLabels, eventNoteLabels } from "@/lib/applications/presentation";
import { allowedTargets } from "@/lib/applications/stage-machine";
import { logTrackerView } from "@/lib/applications/tracker-log";
import { getMyApplication, listTimeline } from "@/lib/dal/applications";
import { requireCandidate } from "@/lib/dal/session";
import { formatShortDate } from "@/lib/i18n/format";
import { applicationsPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Application — CHARA", robots: { index: false } };

// The candidate's own application: an id that is somebody else's, unknown or not a uuid shows the not-found page.
export default async function ApplicationPage({ params, searchParams }: PageProps<"/[lang]/applications/[id]">) {
  const { lang, id } = await params;
  await requireCandidate(lang);

  const applicationId = z.uuid().safeParse(id);
  if (!applicationId.success) notFound();
  const [application, timeline] = await Promise.all([getMyApplication(applicationId.data), listTimeline(applicationId.data)]);
  if (!application) notFound();
  logTrackerView("application");
  const existing = (await searchParams).existing === "1";

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title={application.jobTitle}>
        <p className="text-body font-medium wrap-anywhere">{application.employerName}</p>
        <TextLink standalone href={applicationsPath(lang)}>
          My applications
        </TextLink>
      </PageHeader>

      {existing ? (
        <Notice tone="info" role="status">
          You already applied to this vacancy. Here is your application.
        </Notice>
      ) : null}

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Stage</dt>
          <dd className="font-medium">{applicationStatusLabels[application.status]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Applied</dt>
          <dd className="font-medium">
            <time dateTime={application.appliedAt}>{formatShortDate(application.appliedAt)}</time>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="next-step-heading" className="grid gap-2">
        <h2 id="next-step-heading" className="text-h2">
          What usually happens next
        </h2>
        <p className="leading-7">{applicationNextSteps[application.status]}</p>
        {allowedTargets(application.status, "candidate", { shortlisting: false }).includes("withdrawn") ? (
          <WithdrawApplication
            applicationId={application.id}
            jobTitle={application.jobTitle}
            employerName={application.employerName}
          />
        ) : null}
      </section>

      {application.vacancyIsOpen ? (
        <TextLink standalone href={`/${lang}/jobs/${application.jobId}`}>
          View the vacancy
        </TextLink>
      ) : null}

      {application.coverNote ? (
        <section aria-labelledby="cover-note-heading" className="grid gap-2">
          <h2 id="cover-note-heading" className="text-h2">
            Your cover note
          </h2>
          <p className="leading-7 wrap-anywhere whitespace-pre-line">{application.coverNote}</p>
        </section>
      ) : null}

      <section aria-labelledby="timeline-heading" className="grid gap-2">
        <h2 id="timeline-heading" className="text-h2">
          Timeline
        </h2>
        <ol className="grid gap-2">
          {timeline.map((event) => (
            <Card as="li" padding="sm" key={`${event.createdAt}-${event.toStatus}`} className="block">
              <p className="font-medium">
                {applicationStatusLabels[event.toStatus]}{" "}
                <time dateTime={event.createdAt} className="font-normal text-muted-foreground">
                  {formatShortDate(event.createdAt)}
                </time>
              </p>
              <p className="text-small text-muted-foreground">{eventActorLabels[event.actorRole]}</p>
              {event.note ? (
                <div className="mt-1 grid gap-0.5">
                  <p className="text-small text-muted-foreground">{eventNoteLabels[event.actorRole]}</p>
                  <p className="wrap-anywhere whitespace-pre-line">{event.note}</p>
                </div>
              ) : null}
            </Card>
          ))}
        </ol>
      </section>
    </div>
  );
}
