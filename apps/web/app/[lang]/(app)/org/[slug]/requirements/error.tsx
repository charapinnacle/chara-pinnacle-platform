"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function RequirementsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <LoadError title="The workforce requirements could not be loaded" retry={retry} />
    </div>
  );
}
