"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function NotificationsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="w-full max-w-3xl">
      <LoadError title="Your notifications could not be loaded" retry={retry} />
    </div>
  );
}
