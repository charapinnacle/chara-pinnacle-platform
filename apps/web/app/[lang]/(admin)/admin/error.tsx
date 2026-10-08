"use client";

import { LoadError } from "@/components/feedback/load-error";

export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError title="The page could not be loaded" retry={retry} />;
}
