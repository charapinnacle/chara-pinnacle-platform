"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function InvitationError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <LoadError title="The invitation could not be loaded" retry={retry} />
    </div>
  );
}
