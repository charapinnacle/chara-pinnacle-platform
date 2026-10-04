import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { requireUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "No access — CHARA", robots: { index: false } };

export default async function ForbiddenPage({ params }: PageProps<"/[lang]/forbidden">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  return (
    <AuthCard
      icon={ShieldAlert}
      title="You do not have access to this page"
      description="Your account does not have the role this page needs."
    >
      <TextLink standalone="center" href={homePath(lang, user.accountKind)}>
        Back to your dashboard
      </TextLink>
    </AuthCard>
  );
}
