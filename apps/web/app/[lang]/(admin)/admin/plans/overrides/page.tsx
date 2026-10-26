import type { Metadata } from "next";
import { Suspense } from "react";
import { OverrideList } from "@/components/admin/override-list";
import { PlanEditorTabs } from "@/components/admin/plan-editor-tabs";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Limit overrides", robots: { index: false } };

// Individual limits of Enterprise organisations with an expiry date (FR-R2 AC5, AC11).
export default async function OverridesPage({ params }: PageProps<"/[lang]/admin/plans/overrides">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  return (
    <div className="grid gap-page">
      <PageHeader title="Limit overrides">
        <p className="text-body text-muted-foreground">
          An override replaces one plan limit of an organisation on an Enterprise plan until the start of its expiry day.
        </p>
      </PageHeader>
      <PlanEditorTabs lang={lang} />
      <Suspense fallback={<LoadingSkeleton rows={4} />}>
        <OverrideList />
      </Suspense>
    </div>
  );
}
