import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsList } from "@/components/admin/settings-list";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Platform settings", robots: { index: false } };

// The allow-listed platform settings and the release switches (FR-R2 AC7, NFR-O5). Every change needs a reason and is
// recorded with the value before and after.
export default async function SettingsPage({ params }: PageProps<"/[lang]/admin/settings">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  return (
    <div className="grid gap-page">
      <PageHeader title="Platform settings">
        <p className="text-body text-muted-foreground">
          Each setting has a type and a range. Changes apply at once and are recorded with the old and new value and your reason.
        </p>
      </PageHeader>
      <Suspense fallback={<LoadingSkeleton rows={6} />}>
        <SettingsList />
      </Suspense>
    </div>
  );
}
