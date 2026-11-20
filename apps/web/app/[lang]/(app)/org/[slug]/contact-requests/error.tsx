"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function OrganizationContactRequestsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full max-w-4xl gap-section">
      <LoadError title="The contact requests could not be loaded" retry={retry} />
    </div>
  );
}
