import type { Metadata } from "next";
import { Suspense } from "react";
import { RetentionList } from "@/components/admin/retention-list";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Retention periods", robots: { index: false } };

// How long each kind of personal data is kept before the daily retention run deletes it (FR-S3 AC10, NFR-O5). Every
// change needs a reason and is recorded with the period before and after.
export default async function RetentionPage({ params }: PageProps<"/[lang]/admin/retention">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  return (
    <div className="grid gap-page">
      <PageHeader title="Retention periods">
        <p className="text-body text-muted-foreground">
          Data older than its period is deleted by the daily retention run. A change applies from the next run and is recorded with the old
          and new period and your reason.
        </p>
      </PageHeader>
      <Suspense fallback={<LoadingSkeleton rows={8} />}>
        <RetentionList />
      </Suspense>
    </div>
  );
}
