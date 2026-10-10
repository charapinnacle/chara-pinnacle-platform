import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as z from "@/lib/zod";
import { UserView } from "@/components/admin/user-view";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "User — CHARA", robots: { index: false } };

export default async function UserPage({ params }: PageProps<"/[lang]/admin/users/[id]">) {
  const { lang, id } = await params;
  const { roles } = await requirePlatformRole(lang, ["admin", "trust_safety"]);
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <UserView lang={lang} id={id} roles={roles} />
    </Suspense>
  );
}
