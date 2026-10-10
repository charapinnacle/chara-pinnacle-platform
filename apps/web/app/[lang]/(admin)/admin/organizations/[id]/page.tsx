import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as z from "zod";
import { OrganizationView } from "@/components/admin/organization-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Organisation — CHARA", robots: { index: false } };

export default async function OrganizationPage({ params }: PageProps<"/[lang]/admin/organizations/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["admin", "trust_safety"]);
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <OrganizationView lang={lang} id={id} roles={roles} />
    </Suspense>
  );
}
