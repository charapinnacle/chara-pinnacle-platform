import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password — CHARA" };

export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[lang]/forgot-password">) {
  const { lang } = await params;
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email address and we will send you a link to choose a new password. The link
          is valid for 1 hour and works once.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-sm">
        <Link href={`/${lang}/login`} className="underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
