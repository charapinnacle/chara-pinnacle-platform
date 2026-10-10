import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { UserSearch } from "@/components/admin/user-search";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Users — CHARA", robots: { index: false } };

export default async function UsersPage({ params }: PageProps<"/[lang]/admin/users">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin", "trust_safety"]);
  return (
    <div className="grid gap-page">
      <PageHeader title="Users" />
      <UserSearch lang={lang} />
    </div>
  );
}
