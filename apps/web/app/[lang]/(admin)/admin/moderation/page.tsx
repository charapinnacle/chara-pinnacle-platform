import type { Metadata } from "next";
import { JobModerationSearch } from "@/components/admin/job-moderation-search";
import { PageHeading } from "@/components/admin/page-heading";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Vacancy moderation — CHARA", robots: { index: false } };

export default async function ModerationPage({ params }: PageProps<"/[lang]/admin/moderation">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["trust_safety"]);
  return (
    <div className="grid gap-6">
      <PageHeading title="Vacancy moderation">
        <p className="text-body text-muted-foreground">Find a vacancy to hide or unhide. Every decision needs a statement of reasons.</p>
      </PageHeading>
      <JobModerationSearch lang={lang} />
    </div>
  );
}
