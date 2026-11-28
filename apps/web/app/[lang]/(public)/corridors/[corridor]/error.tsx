"use client";

import { LoadError } from "@/components/feedback/load-error";
import { PageContainer } from "@/components/layout/page-container";

export default function CorridorError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer layout="page" className="max-w-3xl">
      <LoadError title="The workforce corridor could not be loaded" retry={retry} homeHref="/" />
    </PageContainer>
  );
}
