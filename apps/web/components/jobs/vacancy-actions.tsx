import { FormButton } from "@/components/forms/form-button";
import { requireLogin } from "@/lib/actions/vacancy";
import type { Viewer } from "@/lib/jobs/viewer";

function Buttons({ disabled, apply, save }: { disabled?: boolean; apply?: () => Promise<void>; save?: () => Promise<void> }) {
  return (
    <div className="flex flex-wrap gap-3">
      <form action={apply}>
        <FormButton disabled={disabled} className="w-auto">
          Apply
        </FormButton>
      </form>
      <form action={save}>
        <FormButton disabled={disabled} variant="secondary" className="w-auto">
          Save
        </FormButton>
      </form>
    </div>
  );
}

const noteClassName = "text-sm text-muted-foreground";

// The employer's preview of the page: the actions as a candidate will see them, switched off.
export function PreviewActions() {
  return (
    <div className="grid gap-2">
      <Buttons disabled />
      <p className={noteClassName}>Apply and Save work once the vacancy is published.</p>
    </div>
  );
}

// Apply and Save on the public page. A visitor is sent to log in and comes back here; only a candidate can use them, and
// a company user is told so instead of being offered buttons.
export function VacancyActions({ jobId, viewer }: { jobId: string; viewer: Viewer }) {
  if (viewer === "company") {
    return <p className={noteClassName}>Only candidates can apply for vacancies or save them.</p>;
  }
  if (viewer === "candidate") {
    return (
      <div className="grid gap-2">
        <Buttons disabled />
        <p className={noteClassName}>Applying and saving open soon.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <Buttons apply={requireLogin.bind(null, "apply", jobId)} save={requireLogin.bind(null, "save", jobId)} />
      <p className={noteClassName}>You log in as a candidate to apply or save, and come back to this vacancy.</p>
    </div>
  );
}
