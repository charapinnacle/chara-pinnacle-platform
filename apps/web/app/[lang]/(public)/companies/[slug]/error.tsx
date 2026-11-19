"use client";

import { LoadError } from "@/components/feedback/load-error";
import { PageContainer } from "@/components/layout/page-container";

export default function CompanyPageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer layout="page" className="max-w-3xl">
      <LoadError title="The company page could not be loaded" retry={retry} />
    </PageContainer>
  );
}
