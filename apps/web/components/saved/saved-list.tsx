"use client";

import { Bookmark } from "lucide-react";
import { useOptimistic } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { useActionCall } from "@/components/feedback/use-action-call";
import { setSavedJob } from "@/lib/actions/saved-jobs";
import type { ApplicationState } from "@/lib/dal/applications";
import type { SavedJob } from "@/lib/dal/saved-jobs";
import { formatDate } from "@/lib/i18n/format";
import { SAVED_HEADING_ID } from "@/lib/jobs/saved";
import { applicationPath, applyPath } from "@/lib/routes";

const badgeClassName = "rounded-full border bg-accent px-2 py-0.5 text-small font-medium text-accent-foreground";

type SavedRowProps = { job: SavedJob; lang: string; applied: ApplicationState | null; onRemove: (id: string) => void };

function SavedRow({ job, lang, applied, onRemove }: SavedRowProps) {
  const { pending, run } = useActionCall("The vacancy was not removed");
  const open = job.available && job.status === "open";
  const title = job.available ? job.title : null;

  function unsave() {
    run(async () => {
      // The row about to leave would take the focus with it.
      document.getElementById(SAVED_HEADING_ID)?.focus();
      onRemove(job.id);
      return setSavedJob(job.id, false);
    }, "Vacancy removed from your saved list");
  }

  return (
    <li className="grid gap-2 rounded-xl border bg-card p-4">
      {job.available ? (
        <>
          <h2 className="text-h2">
            {open ? (
              <TextLink href={`/${lang}/jobs/${job.id}`} className="break-words">
                {job.title}
              </TextLink>
            ) : (
              <span className="break-words">{job.title}</span>
            )}
          </h2>
          <p className="font-medium break-words">{job.employerName}</p>
          <p>
            <span className={badgeClassName}>{open ? "Open" : "No longer open"}</span>
            {applied ? <span className={`${badgeClassName} ms-2`}>Applied</span> : null}
          </p>
        </>
      ) : (
        <h2 className="text-h2">This vacancy is no longer available</h2>
      )}
      <p className="text-small text-muted-foreground">
        Saved <time dateTime={job.savedAt}>{formatDate(job.savedAt)}</time>
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {applied ? (
          <TextLink standalone href={applicationPath(lang, applied.id)}>
            View your application<span className="sr-only"> for {title}</span>
          </TextLink>
        ) : open ? (
          <TextLink standalone href={applyPath(lang, job.id)}>
            Quick apply<span className="sr-only"> for {title}</span>
          </TextLink>
        ) : null}
        <FormButton type="button" variant="secondary" className="w-auto" busy={pending} onClick={unsave}>
          Unsave<span className="sr-only"> vacancy: {title ?? "no longer available"}</span>
        </FormButton>
      </div>
    </li>
  );
}

type SavedListProps = {
  lang: string;
  jobs: SavedJob[];
  // The non-withdrawn application of the candidate for each vacancy, by vacancy id.
  applications: Record<string, ApplicationState>;
  nextHref: string | null;
  firstHref: string | null;
};

export function SavedList({ lang, jobs, applications, nextHref, firstHref }: SavedListProps) {
  const [visible, removeRow] = useOptimistic(jobs, (current, id: string) => current.filter((job) => job.id !== id));

  if (visible.length === 0) {
    return firstHref ? (
      <EmptyState icon={Bookmark} title="No more saved vacancies on this page">
        <TextLink standalone href={firstHref}>
          Back to the first page
        </TextLink>
      </EmptyState>
    ) : (
      <EmptyState icon={Bookmark} title="No saved vacancies yet" description="Save a vacancy to keep it here.">
        <TextLink standalone href={`/${lang}/jobs`}>
          Find Jobs
        </TextLink>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {visible.map((job) => (
          <SavedRow key={job.id} job={job} lang={lang} applied={applications[job.id] ?? null} onRemove={removeRow} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextHref ? (
          <TextLink standalone href={nextHref}>
            Next page
          </TextLink>
        ) : null}
        {firstHref ? (
          <TextLink standalone href={firstHref}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
