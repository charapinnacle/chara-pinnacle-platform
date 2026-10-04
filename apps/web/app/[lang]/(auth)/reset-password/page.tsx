import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
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
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          This link has expired or was already used
        </h1>
        <p className="text-sm">
          <Link href={`/${lang}/forgot-password`} className="underline underline-offset-4">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <ResetPasswordForm tokenHash={tokenHash} />
    </div>
  );
}
