import type { Metadata } from "next";
import { Suspense } from "react";
import { GrantRoleDialog } from "@/components/admin/grant-role-dialog";
import { PageHeading } from "@/components/admin/page-heading";
import { StaffList } from "@/components/admin/staff-list";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Staff — CHARA", robots: { index: false } };

export default async function StaffPage({ params }: PageProps<"/[lang]/admin/staff">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);
  return (
    <div className="grid gap-6">
      <PageHeading title="Staff">
        <p className="text-body text-muted-foreground">
          Roles of the people who run the platform. A revoked role stays in the list as history. Staff must verify with two steps to use the console.
        </p>
      </PageHeading>
      <div>
        <GrantRoleDialog />
      </div>
      <Suspense fallback={<LoadingSkeleton rows={4} />}>
        <StaffList />
      </Suspense>
    </div>
  );
}
