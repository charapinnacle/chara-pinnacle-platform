import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { changeRecoveryAddress, resendResetEmail } from "@/lib/actions/recovery";
import { cooldownLeft, maskEmail, pendingEmail } from "@/lib/pending-email";
import { signUpPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Check your email", robots: { index: false } };

export default async function ResetSentPage({ params }: PageProps<"/[lang]/forgot-password/check-email">) {
  const { lang } = await params;
  const pending = await pendingEmail("recovery");
  if (!pending) redirect(`/${lang}/forgot-password`);
  return (
    <AuthCard
      icon={Mail}
      title="Check your email"
      description={`If an account exists for ${maskEmail(pending.email)}, we have sent a link to reset the password.`}
    >
      <p className="text-center text-small text-muted-foreground text-balance">
        Not received? Check the address or <TextLink href={signUpPath(lang)}>create an account</TextLink>. The link is valid
        for 1 hour and works once. Wait a minute before asking for another.
      </p>
      <CheckEmailPanel
        initialCooldown={cooldownLeft(pending.sentAt)}
        resend={resendResetEmail}
        changeAddress={changeRecoveryAddress}
      />
    </AuthCard>
  );
}
