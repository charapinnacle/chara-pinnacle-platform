import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { getMyApplication, listTimeline } from "@/lib/dal/applications";
import { requireUser } from "@/lib/dal/session";
import { formatShortDate } from "@/lib/i18n/format";
import { applicationsPath, homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Application — CHARA", robots: { index: false } };

// The candidate's own application: an id that is somebody else's, unknown or not a uuid shows the not-found page.
export default async function ApplicationPage({ params, searchParams }: PageProps<"/[lang]/applications/[id]">) {
  const { lang, id } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "worker") redirect(homePath(lang, user.accountKind));

  const applicationId = z.uuid().safeParse(id);
  if (!applicationId.success) notFound();
  const [application, timeline] = await Promise.all([getMyApplication(applicationId.data), listTimeline(applicationId.data)]);
  if (!application) notFound();
  const existing = (await searchParams).existing === "1";

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere sm:text-[1.75rem]">{application.jobTitle}</h1>
        <p className="text-body font-medium wrap-anywhere">{application.employerName}</p>
        <TextLink standalone href={applicationsPath(lang)}>
          My applications
        </TextLink>
      </header>

      {existing ? (
        <Notice tone="info" role="status">
          You already applied to this vacancy. Here is your application.
        </Notice>
      ) : null}

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Stage</dt>
          <dd className="font-medium">{applicationStatusLabels[application.status]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Applied</dt>
          <dd className="font-medium">
            <time dateTime={application.appliedAt}>{formatShortDate(application.appliedAt)}</time>
          </dd>
        </div>
      </dl>

      {application.vacancyIsOpen ? (
        <TextLink standalone href={`/${lang}/jobs/${application.jobId}`}>
          View the vacancy
        </TextLink>
      ) : null}

      {application.coverNote ? (
        <section aria-labelledby="cover-note-heading" className="grid gap-2">
          <h2 id="cover-note-heading" className="text-lg font-semibold">
            Your cover note
          </h2>
          <p className="leading-7 wrap-anywhere whitespace-pre-line">{application.coverNote}</p>
        </section>
      ) : null}

      <section aria-labelledby="timeline-heading" className="grid gap-2">
        <h2 id="timeline-heading" className="text-lg font-semibold">
          Timeline
        </h2>
        <ol className="grid gap-2">
          {timeline.map((event) => (
            <li key={event.id} className="rounded-xl border bg-card p-3">
              <p className="font-medium">
                {applicationStatusLabels[event.toStatus]}{" "}
                <time dateTime={event.createdAt} className="font-normal text-muted-foreground">
                  {formatShortDate(event.createdAt)}
                </time>
              </p>
              {event.note ? (
                <div className="mt-1 grid gap-0.5">
                  <p className="text-sm text-muted-foreground">Message from the employer</p>
                  <p className="wrap-anywhere whitespace-pre-line">{event.note}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
