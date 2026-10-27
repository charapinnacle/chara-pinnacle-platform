"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function RequirementPartnersError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <LoadError title="The partner suggestions could not be loaded" retry={retry} />
    </div>
  );
}
