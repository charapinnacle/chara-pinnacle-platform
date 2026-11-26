"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function AnalyticsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="w-full">
      <LoadError title="Your analytics could not be loaded" retry={retry} />
    </div>
  );
}
