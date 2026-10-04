import type { Metadata } from "next";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { LoginForm } from "@/components/auth/login-form";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { googleSignInEnabled } from "@/lib/env";
import { GOOGLE_ERRORS, isGoogleErrorCode } from "@/lib/google-sign-in";

export const metadata: Metadata = { title: "Log in — CHARA" };

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[lang]/login">) {
  const [{ lang }, { next, error }] = await Promise.all([params, searchParams]);
  const google = googleSignInEnabled();
  return (
    <AuthCard
      title="Log in"
      footer={
        <p className="flex flex-wrap items-center gap-x-1.5">
          New to CHARA?
          <TextLink standalone="flush" href={`/${lang}/signup`}>
            Create an account
          </TextLink>
        </p>
      }
    >
      {isGoogleErrorCode(error) ? (
        <Notice tone="error" role="alert">
          {GOOGLE_ERRORS[error]}
        </Notice>
      ) : null}
      {google ? (
        <GoogleSignIn note="Accounts created with Google have no password. Use this button to log in to them." />
      ) : null}
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthCard>
  );
}
