import type { Metadata } from "next";
import { AuthCard } from "@/components/layout/auth-card";
import { requirePlatformStaff } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Administration — CHARA", robots: { index: false } };

export default async function AdminPage({ params }: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  await requirePlatformStaff(lang);
  return <AuthCard title="Administration" />;
}
