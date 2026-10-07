import { FormButton } from "@/components/forms/form-button";
import { SaveJob } from "@/components/jobs/save-job";
import { requireLogin } from "@/lib/actions/vacancy";
import type { Viewer } from "@/lib/jobs/viewer";

type VacancyActionsProps = { job: { id: string; title: string }; lang: string; viewer: Viewer; saved: boolean };

const noteClassName = "text-sm text-muted-foreground";

// The employer's preview of the page: the actions as a candidate will see them, switched off.
export function PreviewActions() {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-3">
        <FormButton disabled className="w-auto">
          Apply
        </FormButton>
        <FormButton disabled variant="secondary" className="w-auto">
          Save
        </FormButton>
      </div>
      <p className={noteClassName}>Apply and Save work once the vacancy is published.</p>
    </div>
  );
}

// Apply and Save on the public page. A visitor is sent to log in and comes back here; only a candidate can use them, and
// a company user is told so instead of being offered buttons. A candidate's Apply is switched off until the application
// step exists (FR-D1); Save works.
export function VacancyActions({ job, lang, viewer, saved }: VacancyActionsProps) {
  if (viewer === "company") {
    return <p className={noteClassName}>Only candidates can apply for vacancies or save them.</p>;
  }
  const next = `/${lang}/jobs/${job.id}`;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-3">
        <form action={viewer === "visitor" ? requireLogin.bind(null, "apply", job.id, next) : undefined}>
          <FormButton disabled={viewer === "candidate"} className="w-auto">
            Apply
          </FormButton>
        </form>
        <SaveJob jobId={job.id} title={job.title} viewer={viewer} saved={saved} next={next} />
      </div>
      <p className={noteClassName}>
        {viewer === "candidate"
          ? "Applying opens soon."
          : "You log in as a candidate to apply or save, and come back to this vacancy."}
      </p>
    </div>
  );
}
