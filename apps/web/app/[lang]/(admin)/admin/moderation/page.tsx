import type { Metadata } from "next";
import { JobModerationSearch } from "@/components/admin/job-moderation-search";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Vacancy moderation — CHARA", robots: { index: false } };

export default async function ModerationPage({ params }: PageProps<"/[lang]/admin/moderation">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["trust_safety"]);
  return (
    <div className="grid gap-page">
      <PageHeader title="Vacancy moderation">
        <p className="text-body text-muted-foreground">Find a vacancy to hide or unhide. Every decision needs a statement of reasons.</p>
      </PageHeader>
      <JobModerationSearch lang={lang} />
    </div>
  );
}
