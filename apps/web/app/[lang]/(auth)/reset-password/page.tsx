import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { hasRecoverySession, isRecoveryLinkFresh } from "@/lib/dal/recovery";

export const metadata: Metadata = {
  title: "Choose a new password — CHARA",
  robots: { index: false },
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<"/[lang]/reset-password">) {
  const [{ lang }, { token_hash: tokenHash }] = await Promise.all([params, searchParams]);
  // Each submission re-renders this page: once the link is spent, the session it opened keeps the form up.
  const open =
    typeof tokenHash === "string" &&
    ((await isRecoveryLinkFresh(tokenHash)) || (await hasRecoverySession()));
  if (!open) {
    return (
      <AuthCard icon={Link2Off} title="This link has expired or was already used">
        <TextLink standalone href={`/${lang}/forgot-password`} className="justify-self-center text-body">
          Request a new reset link
        </TextLink>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <ResetPasswordForm tokenHash={tokenHash} />
    </AuthCard>
  );
}
