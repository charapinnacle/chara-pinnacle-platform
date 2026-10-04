import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { ConfirmButton } from "@/components/auth/confirm-button";
import { AuthCard } from "@/components/layout/auth-card";
import { confirmEmail } from "@/lib/actions/auth";

export const metadata: Metadata = {
  title: "Confirm your email — CHARA",
  robots: { index: false },
};

export default async function ConfirmEmailPage({
  params,
  searchParams,
}: PageProps<"/[lang]/confirm-email">) {
  const [{ lang }, { token_hash: tokenHash }] = await Promise.all([params, searchParams]);
  if (typeof tokenHash !== "string") redirect(`/${lang}/verify-email?error=invalid_link`);
  return (
    <AuthCard
      icon={MailCheck}
      title="Confirm your email address"
      description="Select the button to finish creating your account."
    >
      <form action={confirmEmail} className="grid">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <ConfirmButton />
      </form>
    </AuthCard>
  );
}
