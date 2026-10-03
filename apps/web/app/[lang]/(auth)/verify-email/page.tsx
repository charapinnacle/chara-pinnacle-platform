import type { Metadata } from "next";
import { ResendForm } from "@/components/auth/resend-form";

export const metadata: Metadata = { title: "Check your email — CHARA" };

export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/[lang]/verify-email">) {
  const { error } = await searchParams;
  const invalidLink = error === "invalid_link";
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {invalidLink ? "This link is invalid or has expired." : "Check your email"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {invalidLink
            ? "Enter your email address to request a new confirmation link."
            : "If the address can be used for a new account, we have sent a confirmation link. The link is valid for 24 hours and works once. Confirm your email address before you log in."}
        </p>
      </div>
      <ResendForm />
    </div>
  );
}
