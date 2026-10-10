import { Notice } from "@/components/forms/notice";
import { PageHeader } from "@/components/layout/page-header";

export function SuspendedOrganization({ title = "Applicants", subject = "applicants" }: { title?: string; subject?: string }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <PageHeader title={title} />
      <Notice tone="error" role="alert">
        This organization is suspended, so its {subject} are not available.
      </Notice>
    </div>
  );
}
