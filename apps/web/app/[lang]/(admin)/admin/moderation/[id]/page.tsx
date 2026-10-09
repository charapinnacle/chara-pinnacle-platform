import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { JobModerationView } from "@/components/admin/job-moderation-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Vacancy moderation — CHARA", robots: { index: false } };

export default async function ModerationJobPage({ params }: PageProps<"/[lang]/admin/moderation/[id]">) {
  const { lang, id } = await params;
  await requirePlatformRole(lang, ["trust_safety"]);
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <JobModerationView lang={lang} id={id} />
    </Suspense>
  );
}
