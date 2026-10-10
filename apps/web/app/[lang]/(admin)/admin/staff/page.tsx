import type { Metadata } from "next";
import { Suspense } from "react";
import { GrantRoleDialog } from "@/components/admin/grant-role-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { StaffList } from "@/components/admin/staff-list";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Staff — CHARA", robots: { index: false } };

export default async function StaffPage({ params, searchParams }: PageProps<"/[lang]/admin/staff">) {
  const [{ lang }, { after }] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["admin"]);
  const cursor = typeof after === "string" && /^\d{1,15}$/.test(after) ? Number(after) : null;
  return (
    <div className="grid gap-page">
      <PageHeader title="Staff">
        <p className="text-body text-muted-foreground">
          Roles of the people who run the platform. A revoked role stays in the list as history. Staff must verify with two steps to use the console.
        </p>
      </PageHeader>
      <div>
        <GrantRoleDialog />
      </div>
      <Suspense key={cursor ?? "first"} fallback={<LoadingSkeleton rows={4} />}>
        <StaffList lang={lang} after={cursor} />
      </Suspense>
    </div>
  );
}
