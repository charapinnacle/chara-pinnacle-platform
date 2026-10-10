import type { Metadata } from "next";
import { AuditSearch } from "@/components/admin/audit-search";
import { PageHeader } from "@/components/layout/page-header";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Audit log — CHARA", robots: { index: false } };

export default async function AuditPage({ params }: PageProps<"/[lang]/admin/audit">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);
  return (
    <div className="grid gap-6">
      <PageHeader title="Audit log">
        <p className="text-body text-muted-foreground">Every administrative action, newest first. The times are in UTC.</p>
      </PageHeader>
      <AuditSearch lang={lang} />
    </div>
  );
}
