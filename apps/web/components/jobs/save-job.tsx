import { Bookmark } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { SaveJobButton } from "@/components/jobs/save-job-button";
import { requireLogin } from "@/lib/actions/vacancy";
import type { Viewer } from "@/lib/jobs/viewer";

type SaveJobProps = { jobId: string; title: string; viewer: Viewer; saved: boolean; next: string };

// Save for whoever looks at a result card or a vacancy: a candidate saves, a visitor is sent to log in and comes back to
// the page `next`, and a company user is offered nothing (the vacancy page says why).
export function SaveJob({ jobId, title, viewer, saved, next }: SaveJobProps) {
  if (viewer === "candidate") return <SaveJobButton jobId={jobId} title={title} saved={saved} />;
  if (viewer === "company") return null;
  return (
    <form action={requireLogin.bind(null, "save", jobId, next)}>
      <FormButton variant="secondary" className="w-auto" aria-label={`Save vacancy: ${title}`}>
        <Bookmark aria-hidden className="size-4" />
        Save
      </FormButton>
    </form>
  );
}
