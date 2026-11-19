import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportQueue } from "@/components/admin/report-queue";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";
import { reportListFilterSchema, reportQueueCursorSchema } from "@/lib/validation/report";

export const metadata: Metadata = { title: "Reports", robots: { index: false } };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The queue of Trust & Safety, which a Platform Administrator may read (FR-F1, FR-S1). The address is the state: the
// filters and the cursor the page continues after.
export default async function ReportsPage({ params, searchParams }: PageProps<"/[lang]/admin/reports">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["trust_safety", "admin"]);
  const filter = reportListFilterSchema.parse({ status: first(query.status), type: first(query.type) });
  const after = reportQueueCursorSchema.safeParse(first(query.after) ?? "").data ?? null;

  return (
    <div className="grid gap-page">
      <PageHeader title="Reports">
        <p className="text-body text-muted-foreground">
          What visitors, candidates and companies reported. Open reports of fee demands come first, then the others by the
          time they are due.
        </p>
      </PageHeader>
      <Suspense key={`${filter.status}-${filter.type ?? ""}-${first(query.after) ?? ""}`} fallback={<LoadingSkeleton rows={4} />}>
        <ReportQueue lang={lang} filter={filter} after={after} />
      </Suspense>
    </div>
  );
}
