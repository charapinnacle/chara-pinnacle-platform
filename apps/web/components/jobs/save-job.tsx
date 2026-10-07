import { Bookmark } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { SaveJobButton } from "@/components/jobs/save-job-button";
import { requireLogin } from "@/lib/actions/vacancy";
import type { Viewer } from "@/lib/jobs/viewer";

type SaveJobProps = { jobId: string; title: string; viewer: Exclude<Viewer, "company">; saved: boolean; next: string };

// A visitor is sent to log in and comes back to the page `next`.
export function SaveJob({ jobId, title, viewer, saved, next }: SaveJobProps) {
  if (viewer === "candidate") return <SaveJobButton jobId={jobId} title={title} saved={saved} />;
  return (
    <form action={requireLogin.bind(null, "save", jobId, next)}>
      <FormButton variant="secondary" className="w-auto" aria-label={`Save vacancy: ${title}`}>
        <Bookmark aria-hidden className="size-4" />
        Save
      </FormButton>
    </form>
  );
}
