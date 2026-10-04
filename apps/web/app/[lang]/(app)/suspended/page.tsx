import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/layout/auth-card";
import { getCurrentUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Account suspended — CHARA", robots: { index: false } };

export default async function SuspendedPage({ params }: PageProps<"/[lang]/suspended">) {
  const { lang } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${lang}/login`);
  if (!user.suspended) redirect(homePath(lang, user.accountKind));
  return (
    <AuthCard
      icon={ShieldAlert}
      title="Your account is suspended"
      description="See the email we sent you for the reasons and how to respond."
    />
  );
}
