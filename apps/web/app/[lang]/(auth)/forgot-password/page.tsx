import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { googleSignInEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Reset your password — CHARA" };

export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[lang]/forgot-password">) {
  const { lang } = await params;
  return (
    <AuthCard
      title="Reset your password"
      description={`Enter your email address and we will send you a link to choose a new password. The link is valid for 1 hour and works once.${googleSignInEnabled() ? " If you sign in with Google you have no password to reset: go back and use Continue with Google." : ""}`}
      footer={
        <TextLink standalone="flush" href={`/${lang}/login`}>
          Back to log in
        </TextLink>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
