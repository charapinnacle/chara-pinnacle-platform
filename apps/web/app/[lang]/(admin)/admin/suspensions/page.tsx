import type { Metadata } from "next";
import { Suspense } from "react";
import { ModerationLog } from "@/components/admin/moderation-log";
import { PageHeading } from "@/components/admin/page-heading";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Suspensions and reinstatements — CHARA", robots: { index: false } };

export default async function SuspensionsPage({ params, searchParams }: PageProps<"/[lang]/admin/suspensions">) {
  const [{ lang }, { after }] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["trust_safety"]);
  const cursor = typeof after === "string" && /^\d{1,15}$/.test(after) ? Number(after) : null;

  return (
    <div className="grid gap-6">
      <PageHeading title="Suspensions and reinstatements">
        <p className="text-body text-muted-foreground">
          Open a user or an organisation from the search to suspend or reinstate it. This is the record, newest first.
        </p>
      </PageHeading>
      <Suspense key={cursor ?? "newest"} fallback={<LoadingSkeleton rows={4} />}>
        <ModerationLog lang={lang} after={cursor} />
      </Suspense>
    </div>
  );
}
