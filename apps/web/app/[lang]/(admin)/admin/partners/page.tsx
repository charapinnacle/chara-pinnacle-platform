import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PartnerReviewQueue } from "@/components/admin/partner-review-queue";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { isReleased } from "@/lib/dal/release";
import { requirePlatformRole } from "@/lib/dal/session";
import { queueCursorSchema } from "@/lib/validation/partner-review";

export const metadata: Metadata = { title: "Partner reviews", robots: { index: false } };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The queue "Partners to review" (FR-J4 AC1): Trust & Safety decide; a Verification Reviewer and a Platform Administrator
// read it. Release 2a only. The address is the state: the cursor the page continues after.
export default async function PartnerReviewsPage({ params, searchParams }: PageProps<"/[lang]/admin/partners">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["trust_safety", "verification_reviewer", "admin"]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const cursor = queueCursorSchema.safeParse(first(query.after) ?? "");
  const after = cursor.success ? cursor.data : null;
  const decided = first(query.decided) === "1";

  return (
    <div className="grid gap-page">
      <PageHeader title="Partners to review">
        <p className="text-body text-muted-foreground">
          Recruitment and staffing companies waiting to be listed, oldest first. A review is not a verification and is never
          shown as one.
        </p>
      </PageHeader>
      <Suspense key={`${after?.at ?? ""}-${after?.id ?? ""}-${decided}`} fallback={<LoadingSkeleton rows={4} />}>
        <PartnerReviewQueue lang={lang} after={after} decided={decided} />
      </Suspense>
    </div>
  );
}
