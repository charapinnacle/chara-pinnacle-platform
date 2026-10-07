"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function ApplicantsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <LoadError title="The applicant could not be loaded" retry={retry} />
    </div>
  );
}
