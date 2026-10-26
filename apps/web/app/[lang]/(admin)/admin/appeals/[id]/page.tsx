import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppealView } from "@/components/admin/appeal-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { isReleased } from "@/lib/dal/release";
import { requirePlatformRole } from "@/lib/dal/session";
import { idParam } from "@/lib/validation/appeal";

export const metadata: Metadata = { title: "Appeal", robots: { index: false } };

// Trust & Safety decide; a Platform Administrator reads the same page without the decision. Release 2a only.
export default async function AppealPage({ params }: PageProps<"/[lang]/admin/appeals/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["trust_safety", "admin"]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const appealId = idParam(id);
  if (appealId === null) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <AppealView lang={lang} id={appealId} canAct={roles.includes("trust_safety")} />
    </Suspense>
  );
}
