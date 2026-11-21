import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PlanEditorTabs } from "@/components/admin/plan-editor-tabs";
import { PlanHistory } from "@/components/admin/plan-history";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { listEditorPlans } from "@/lib/dal/plan-editor";
import { requirePlatformRole } from "@/lib/dal/session";
import { adminPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Plan history", robots: { index: false } };

// The change history of one plan (FR-R2 AC11). No customer, subscription or payment data is read.
export default async function PlanHistoryPage({ params }: PageProps<"/[lang]/admin/plans/[code]">) {
  const { lang, code } = await params;
  await requirePlatformRole(lang, ["admin"]);
  const plan = (await listEditorPlans()).find((row) => row.code === code);
  if (!plan) notFound();

  return (
    <div className="grid gap-page">
      <PageHeader
        title={`History of ${plan.name}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Plans and limits", href: adminPath(lang, "plans") }, { label: plan.code }]} />}
      >
        <p className="text-body text-muted-foreground break-words">Plan code {plan.code}. Newest change first.</p>
      </PageHeader>
      <PlanEditorTabs lang={lang} />
      <Suspense fallback={<LoadingSkeleton rows={4} />}>
        <PlanHistory code={plan.code} />
      </Suspense>
    </div>
  );
}
