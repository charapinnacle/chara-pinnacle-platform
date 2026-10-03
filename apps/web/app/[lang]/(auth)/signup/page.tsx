import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { getSignUpForm } from "@/lib/dal/legal";

export const metadata: Metadata = { title: "Create your account — CHARA" };

export default async function SignupPage() {
  const { documents, attestationWording } = await getSignUpForm();
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <SignupForm documents={documents} attestationWording={attestationWording} />
    </div>
  );
}
