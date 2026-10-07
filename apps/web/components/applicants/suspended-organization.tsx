import { Notice } from "@/components/forms/notice";

export function SuspendedOrganization() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Applicants</h1>
      <Notice tone="error" role="alert">
        This organization is suspended, so its applicants are not available.
      </Notice>
    </div>
  );
}
