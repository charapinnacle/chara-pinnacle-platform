import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { listMyApplications } from "@/lib/dal/applications";
import { requireUser } from "@/lib/dal/session";
import { formatShortDate } from "@/lib/i18n/format";
import { applicationPath, applicationsPath, homePath } from "@/lib/routes";
import { parseListCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "My applications — CHARA", robots: { index: false } };

const badgeClassName = "rounded-full border bg-accent px-2 py-0.5 text-sm font-medium text-accent-foreground";

// For candidates: a visitor goes to log in (requireUser), any other account goes to its own home.
export default async function ApplicationsPage({ params, searchParams }: PageProps<"/[lang]/applications">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "worker") redirect(homePath(lang, user.accountKind));

  const cursor = parseListCursor((await searchParams).cursor);
  const { applications, nextCursor } = await listMyApplications(cursor);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
          My applications
        </h1>
        <p className="text-body text-muted-foreground">The vacancies you applied to, newest first.</p>
      </header>
      {applications.length === 0 ? (
        cursor ? (
          <EmptyState icon={FileText} title="No more applications on this page">
            <TextLink standalone href={applicationsPath(lang)}>
              Back to the first page
            </TextLink>
          </EmptyState>
        ) : (
          <EmptyState
            icon={FileText}
            title="You have not applied to any vacancy yet"
            description="Applications you send appear here with their stage."
          >
            <TextLink standalone href={`/${lang}/jobs`}>
              Find vacancies
            </TextLink>
          </EmptyState>
        )
      ) : (
        <div className="grid gap-4">
          <ul className="grid gap-3">
            {applications.map((application) => (
              <li key={application.id} className="grid gap-2 rounded-xl border bg-card p-4">
                <h2 className="text-lg font-semibold">
                  <TextLink href={applicationPath(lang, application.id)} className="break-words">
                    {application.jobTitle}
                  </TextLink>
                </h2>
                <p className="font-medium break-words">{application.employerName}</p>
                <p>
                  <span className={badgeClassName}>{applicationStatusLabels[application.status]}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Applied <time dateTime={application.appliedAt}>{formatShortDate(application.appliedAt)}</time>
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-6">
            {nextCursor ? (
              <TextLink standalone href={applicationsPath(lang, nextCursor)}>
                Next page
              </TextLink>
            ) : null}
            {cursor ? (
              <TextLink standalone href={applicationsPath(lang)}>
                Back to the first page
              </TextLink>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
