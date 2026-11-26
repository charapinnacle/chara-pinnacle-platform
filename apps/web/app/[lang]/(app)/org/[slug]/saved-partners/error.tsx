"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function SavedPartnersError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="w-full">
      <LoadError title="Your saved partners could not be loaded" retry={retry} />
    </div>
  );
}
