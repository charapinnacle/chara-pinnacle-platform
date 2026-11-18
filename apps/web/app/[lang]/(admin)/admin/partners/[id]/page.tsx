import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as z from "zod";
import { PartnerReviewView } from "@/components/admin/partner-review-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { getPartnerReviewDetail } from "@/lib/dal/admin-partner-reviews";
import { isReleased } from "@/lib/dal/release";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Partner review", robots: { index: false } };

// The review page of one partner (FR-J4 AC2): Trust & Safety decide, a Verification Reviewer and a Platform Administrator
// read. Release 2a only.
export default async function PartnerReviewPage({ params }: PageProps<"/[lang]/admin/partners/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["trust_safety", "verification_reviewer", "admin"]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const organizationId = z.uuid().safeParse(id);
  // Checked before the Suspense boundary, so that an unknown id answers 404 rather than 200 with the not-found page.
  if (!organizationId.success || !(await getPartnerReviewDetail(organizationId.data))) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={6} />}>
      <PartnerReviewView lang={lang} id={organizationId.data} roles={roles} />
    </Suspense>
  );
}
