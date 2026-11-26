"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function PartnerSubmissionsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full gap-section">
      <LoadError title="Your candidates could not be loaded" retry={retry} />
    </div>
  );
}
