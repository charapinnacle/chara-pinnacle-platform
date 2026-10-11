import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { AuthCard } from "@/components/layout/auth-card";
import { resendResetEmail } from "@/lib/actions/recovery";
import { cooldownLeft, maskEmail, pendingEmail } from "@/lib/pending-email";

export const metadata: Metadata = { title: "Check your email — CHARA", robots: { index: false } };

export default async function ResetSentPage({ params }: PageProps<"/[lang]/forgot-password/check-email">) {
  const { lang } = await params;
  const pending = await pendingEmail("recovery");
  if (!pending) redirect(`/${lang}/forgot-password`);
  return (
    <AuthCard
      icon={Mail}
      title="Check your email"
      description="If an account exists for this address, we have sent a link to choose a new password. The link is valid for 1 hour and works once."
    >
      <CheckEmailPanel
        maskedEmail={maskEmail(pending.email)}
        initialCooldown={cooldownLeft(pending.sentAt)}
        resend={resendResetEmail}
        differentAddressHref={`/${lang}/forgot-password`}
      />
    </AuthCard>
  );
}
