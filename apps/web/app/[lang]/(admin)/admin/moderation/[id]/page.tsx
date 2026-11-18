import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as z from "zod";
import { JobModerationView } from "@/components/admin/job-moderation-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { getModerationJob } from "@/lib/dal/admin-jobs";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Vacancy moderation", robots: { index: false } };

export default async function ModerationJobPage({ params }: PageProps<"/[lang]/admin/moderation/[id]">) {
  const { lang, id } = await params;
  await requirePlatformRole(lang, ["trust_safety"]);
  // Checked before the Suspense boundary, so that an unknown id answers 404 rather than 200 with the not-found page.
  if (!z.uuid().safeParse(id).success || !(await getModerationJob(id))) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <JobModerationView lang={lang} id={id} />
    </Suspense>
  );
}
