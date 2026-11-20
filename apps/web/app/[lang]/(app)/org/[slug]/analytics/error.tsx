"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function AnalyticsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="w-full max-w-5xl">
      <LoadError title="Your analytics could not be loaded" retry={retry} />
    </div>
  );
}
