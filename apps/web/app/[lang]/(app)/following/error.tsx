"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function FollowingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="w-full">
      <LoadError title="Your followed companies could not be loaded" retry={retry} />
    </div>
  );
}
