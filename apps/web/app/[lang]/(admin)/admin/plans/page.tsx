import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanEditorTabs } from "@/components/admin/plan-editor-tabs";
import { PlanList } from "@/components/admin/plan-list";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Plans and limits", robots: { index: false } };

// The plan editor (FR-R2 AC1, AC10): a Platform Administrator at aal2 changes names, visibility, trial length, limits and
// features with a reason. The pages are rendered per request, so pricing and billing pages show a change at the next
// request (AC12). Prices are changed at the payment provider (V17).
export default async function PlansPage({ params }: PageProps<"/[lang]/admin/plans">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  return (
    <div className="grid gap-page">
      <PageHeader title="Plans and limits">
        <p className="text-body text-muted-foreground">
          Changes apply at once to every organisation on the plan and are recorded with the old and new values and your reason.
          Prices are not changed here.
        </p>
      </PageHeader>
      <PlanEditorTabs lang={lang} />
      <Suspense fallback={<LoadingSkeleton rows={6} />}>
        <PlanList lang={lang} />
      </Suspense>
    </div>
  );
}
