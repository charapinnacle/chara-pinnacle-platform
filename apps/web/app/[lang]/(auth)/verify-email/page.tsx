import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { ResendForm } from "@/components/auth/resend-form";
import { AuthCard } from "@/components/layout/auth-card";

export const metadata: Metadata = { title: "Check your email — CHARA" };

export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/[lang]/verify-email">) {
  const { error } = await searchParams;
  const invalidLink = error === "invalid_link";
  return (
    <AuthCard
      icon={Mail}
      title={invalidLink ? "This link is invalid or has expired." : "Check your email"}
      description={
        invalidLink
          ? "Enter your email address to request a new confirmation link."
          : "If the address can be used for a new account, we have sent a confirmation link. The link is valid for 24 hours and works once. Confirm your email address before you log in."
      }
    >
      <ResendForm />
    </AuthCard>
  );
}
