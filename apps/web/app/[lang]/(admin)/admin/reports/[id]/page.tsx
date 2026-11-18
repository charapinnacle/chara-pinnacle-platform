import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReportView } from "@/components/admin/report-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { getReport } from "@/lib/dal/admin-reports";
import { requirePlatformRole } from "@/lib/dal/session";
import { reportIdSchema } from "@/lib/validation/report";

export const metadata: Metadata = { title: "Report", robots: { index: false } };

// Trust & Safety decide; a Platform Administrator reads the same page without the decision.
export default async function ReportPage({ params }: PageProps<"/[lang]/admin/reports/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["trust_safety", "admin"]);
  const reportId = reportIdSchema.safeParse(/^\d{1,15}$/.test(id) ? Number(id) : null);
  // Checked before the Suspense boundary, so that an unknown id answers 404 rather than 200 with the not-found page.
  if (!reportId.success || !(await getReport(reportId.data))) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <ReportView lang={lang} id={reportId.data} canAct={roles.includes("trust_safety")} />
    </Suspense>
  );
}
