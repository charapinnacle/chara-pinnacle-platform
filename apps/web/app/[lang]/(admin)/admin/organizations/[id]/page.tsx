import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as z from "zod";
import { OrganizationView } from "@/components/admin/organization-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { getOrganization } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Organisation", robots: { index: false } };

export default async function OrganizationPage({ params }: PageProps<"/[lang]/admin/organizations/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["admin", "trust_safety"]);
  // Checked before the Suspense boundary, so that an unknown id answers 404 rather than 200 with the not-found page.
  if (!z.uuid().safeParse(id).success || !(await getOrganization(id))) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <OrganizationView lang={lang} id={id} roles={roles} />
    </Suspense>
  );
}
