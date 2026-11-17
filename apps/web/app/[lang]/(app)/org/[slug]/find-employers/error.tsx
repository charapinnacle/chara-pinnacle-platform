"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function FindEmployersError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full max-w-5xl gap-section">
      <LoadError title="The employers could not be loaded" retry={retry} />
    </div>
  );
}
