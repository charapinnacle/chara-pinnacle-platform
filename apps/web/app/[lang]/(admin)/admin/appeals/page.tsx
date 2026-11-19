import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppealQueue } from "@/components/admin/appeal-queue";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { isReleased } from "@/lib/dal/release";
import { requirePlatformRole } from "@/lib/dal/session";
import { appealCursorSchema, appealListStatusSchema } from "@/lib/validation/appeal";

export const metadata: Metadata = { title: "Appeals", robots: { index: false } };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The appeals against moderation decisions (FR-S1 AC11): Trust & Safety decide them, a Platform Administrator reads them.
// Release 2a only. The address is the state: the status and the cursor the page continues after.
export default async function AppealsPage({ params, searchParams }: PageProps<"/[lang]/admin/appeals">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["trust_safety", "admin"]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const status = appealListStatusSchema.parse(first(query.status));
  const after = appealCursorSchema.safeParse(first(query.after) ?? "").data ?? null;

  return (
    <div className="grid gap-page">
      <PageHeader title="Appeals">
        <p className="text-body text-muted-foreground">
          Appeals against moderation decisions. Each is decided by a Trust &amp; Safety administrator who did not take the decision.
        </p>
      </PageHeader>
      <Suspense key={`${status}-${first(query.after) ?? ""}`} fallback={<LoadingSkeleton rows={4} />}>
        <AppealQueue lang={lang} status={status} after={after} />
      </Suspense>
    </div>
  );
}
