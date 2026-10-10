"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function ApplicationsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="w-full max-w-3xl">
      <LoadError title="Your applications could not be loaded" retry={retry} />
    </div>
  );
}
