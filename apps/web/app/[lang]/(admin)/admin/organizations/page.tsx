import type { Metadata } from "next";
import { OrganizationSearch } from "@/components/admin/organization-search";
import { PageHeading } from "@/components/admin/page-heading";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Organisations — CHARA", robots: { index: false } };

export default async function OrganizationsPage({ params }: PageProps<"/[lang]/admin/organizations">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin", "trust_safety"]);
  return (
    <div className="grid gap-6">
      <PageHeading title="Organisations" />
      <OrganizationSearch lang={lang} />
    </div>
  );
}
