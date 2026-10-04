import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthCard } from "@/components/layout/auth-card";
import { getSignUpForm } from "@/lib/dal/legal";

export const metadata: Metadata = { title: "Create your account — CHARA" };

export default async function SignupPage() {
  const { documents, attestationWording } = await getSignUpForm();
  return (
    <AuthCard title="Create your account">
      <SignupForm documents={documents} attestationWording={attestationWording} />
    </AuthCard>
  );
}
