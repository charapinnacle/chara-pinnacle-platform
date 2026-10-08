import { Notice } from "@/components/forms/notice";

export function SuspendedOrganization({ title = "Applicants", subject = "applicants" }: { title?: string; subject?: string }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
      <Notice tone="error" role="alert">
        This organization is suspended, so its {subject} are not available.
      </Notice>
    </div>
  );
}
