import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as z from "zod";
import { UserView } from "@/components/admin/user-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { getUser } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "User", robots: { index: false } };

export default async function UserPage({ params }: PageProps<"/[lang]/admin/users/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["admin", "trust_safety"]);
  // Checked before the Suspense boundary, so that an unknown id answers 404 rather than 200 with the not-found page.
  if (!z.uuid().safeParse(id).success || !(await getUser(id))) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <UserView lang={lang} id={id} roles={roles} />
    </Suspense>
  );
}
