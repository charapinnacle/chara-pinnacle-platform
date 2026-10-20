import type { Metadata } from "next";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { LoginForm } from "@/components/auth/login-form";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { googleSignInEnabled } from "@/lib/env";
import { GOOGLE_ERRORS, isGoogleErrorCode } from "@/lib/google-sign-in";
import { BRAND_NAME } from "@/lib/brand";
import { signUpPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[lang]/login">) {
  const [{ lang }, { next, error }] = await Promise.all([params, searchParams]);
  const google = googleSignInEnabled();
  // Someone sent here by Post a job is most likely a new employer, so the sign-up link starts them as one.
  const signUp = typeof next === "string" && next === `/${lang}/post-job` ? signUpPath(lang, "company") : `/${lang}/signup`;
  return (
    <AuthCard
      title="Log in"
      footer={
        <p className="flex flex-wrap items-center gap-x-1.5">
          New to {BRAND_NAME}?
          <TextLink standalone="flush" href={signUp}>
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
