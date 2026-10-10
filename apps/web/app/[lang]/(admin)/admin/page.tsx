import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { entriesFor } from "@/lib/admin/navigation";
import { requirePlatformRole } from "@/lib/dal/session";
import { platformRoleLabels } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Administration — CHARA", robots: { index: false } };

export default async function AdminPage({ params }: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  const { roles } = await requirePlatformRole(lang);
  const hasFunctions = entriesFor(roles).length > 0;

  return (
    <div className="grid gap-4">
      <PageHeader title="Administration">
        <p className="text-body text-muted-foreground">{roles.map((role) => platformRoleLabels[role]).join(", ")}</p>
      </PageHeader>
      <p className="text-body">
        {hasFunctions
          ? "Choose a function from the menu. Every change you make is written to the audit log with your reason."
          : "No functions are available for your role in this release."}
      </p>
    </div>
  );
}
