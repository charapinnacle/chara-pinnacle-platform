import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportQueue } from "@/components/admin/report-queue";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";
import { reportListFilterSchema } from "@/lib/validation/report";

export const metadata: Metadata = { title: "Reports", robots: { index: false } };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The queue of Trust & Safety, which a Platform Administrator may read (FR-F1). The address is the state: the filters and the
// id the page continues after.
export default async function ReportsPage({ params, searchParams }: PageProps<"/[lang]/admin/reports">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["trust_safety", "admin"]);
  const filter = reportListFilterSchema.parse({ status: first(query.status), type: first(query.type) });
  const after = /^\d{1,15}$/.test(first(query.after) ?? "") ? Number(first(query.after)) : null;

  return (
    <div className="grid gap-page">
      <PageHeader title="Reports">
        <p className="text-body text-muted-foreground">
          What visitors, candidates and companies reported. The open reports are listed oldest first.
        </p>
      </PageHeader>
      <Suspense key={`${filter.status}-${filter.type ?? ""}-${after ?? ""}`} fallback={<LoadingSkeleton rows={4} />}>
        <ReportQueue lang={lang} filter={filter} after={after} />
      </Suspense>
    </div>
  );
}
