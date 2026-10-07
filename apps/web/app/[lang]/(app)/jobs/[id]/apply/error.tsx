"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function ApplyError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <LoadError title="The application form could not be loaded" retry={retry} />
    </div>
  );
}
