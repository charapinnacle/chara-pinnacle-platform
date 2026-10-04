import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConfirmButton } from "@/components/auth/confirm-button";
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
    <form action={confirmEmail} className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Confirm your email address</h1>
        <p className="text-sm text-muted-foreground">
          Select the button to finish creating your account.
        </p>
      </div>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <ConfirmButton />
    </form>
  );
}
