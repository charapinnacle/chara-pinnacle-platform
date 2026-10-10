"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function BillingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <LoadError title="Billing details could not be loaded" retry={retry} />
    </div>
  );
}
