import type { Metadata } from "next";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthCard } from "@/components/layout/auth-card";
import { getSignUpForm } from "@/lib/dal/legal";
import { googleSignInEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Create your account — CHARA" };

export default async function SignupPage() {
  const { documents, attestationWording } = await getSignUpForm();
  return (
    <AuthCard title="Create your account">
      {googleSignInEnabled() ? (
        <GoogleSignIn note="You choose worker or employer and accept the legal documents in the next step." />
      ) : null}
      <SignupForm documents={documents} attestationWording={attestationWording} />
    </AuthCard>
  );
}
