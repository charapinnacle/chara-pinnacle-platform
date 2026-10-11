import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { ApplyButton } from "@/components/jobs/apply-button";
import { SaveJob } from "@/components/jobs/save-job";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import type { ApplicationState } from "@/lib/dal/applications";
import { formatShortDate } from "@/lib/i18n/format";
import type { Viewer } from "@/lib/jobs/viewer";
import { applicationPath } from "@/lib/routes";

type VacancyActionsProps = {
  job: { id: string; title: string };
  lang: string;
  viewer: Viewer;
  saved: boolean;
  application: ApplicationState | null;
};

const noteClassName = "text-small text-muted-foreground";

// The employer's preview of the page: the actions as a candidate will see them, switched off.
export function PreviewActions() {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-3">
        <FormButton disabled className="w-auto">
          Apply now
        </FormButton>
        <FormButton disabled variant="secondary" className="w-auto">
          Save job
        </FormButton>
      </div>
      <p className={noteClassName}>Apply now and Save job work once the vacancy is published.</p>
    </div>
  );
}

// What a candidate can do about applying: Apply now while there is no application or only a withdrawn one (Apply again
// after a withdrawal), or the date and stage of the application with a link to it.
function CandidateApply({ job, lang, next, application }: { job: { id: string; title: string }; lang: string; next: string; application: ApplicationState | null }) {
  if (application && application.status !== "withdrawn") {
    return (
      <div className="grid gap-1">
        <p className="font-medium">
          You applied on {formatShortDate(application.createdAt)}, stage {applicationStatusLabels[application.status]}
        </p>
        <TextLink standalone href={applicationPath(lang, application.id)}>
          View your application
        </TextLink>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {application ? <p className="font-medium">You withdrew your application</p> : null}
      <ApplyButton
        jobId={job.id}
        title={job.title}
        lang={lang}
        viewer="candidate"
        next={next}
        label={application ? "Apply again" : "Apply now"}
      />
    </div>
  );
}

// Apply and Save on the public page. A visitor is sent to log in and comes back here; only a candidate can use them, and
// a company user is told so instead of being offered buttons.
export function VacancyActions({ job, lang, viewer, saved, application }: VacancyActionsProps) {
  if (viewer === "company") {
    return <p className={noteClassName}>Only candidates can apply for vacancies or save them.</p>;
  }
  const next = `/${lang}/jobs/${job.id}`;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {viewer === "candidate" ? (
          <CandidateApply job={job} lang={lang} next={next} application={application} />
        ) : (
          <ApplyButton jobId={job.id} title={job.title} lang={lang} viewer={viewer} next={next} />
        )}
        <SaveJob jobId={job.id} title={job.title} viewer={viewer} saved={saved} next={next} />
      </div>
      {viewer === "visitor" ? (
        <p className={noteClassName}>You log in as a candidate to apply or save, and come back to this vacancy.</p>
      ) : null}
    </div>
  );
}
