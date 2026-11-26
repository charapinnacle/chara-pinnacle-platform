"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function JobOrdersError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full gap-section">
      <LoadError title="The job orders could not be loaded" retry={retry} />
    </div>
  );
}
