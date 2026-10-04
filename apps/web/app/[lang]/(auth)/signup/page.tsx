import type { Metadata } from "next";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthCard } from "@/components/layout/auth-card";
import { getSignUpForm } from "@/lib/dal/legal";
import { getInvitationPreview } from "@/lib/dal/team";
import { googleSignInEnabled } from "@/lib/env";
import { invitationTokenSchema } from "@/lib/validation/team";

export const metadata: Metadata = { title: "Create your account — CHARA" };

// A link to /signup?invitation=<token> comes from a team invitation: the address and the account type are fixed, and
// Continue with Google is not offered, since its sign-up cannot carry the invitation.
export default async function SignupPage({ searchParams }: PageProps<"/[lang]/signup">) {
  const [{ documents, attestationWording }, { invitation: token }] = await Promise.all([
    getSignUpForm(),
    searchParams,
  ]);
  const parsed = invitationTokenSchema.safeParse(token);
  const preview = parsed.success ? await getInvitationPreview(parsed.data) : null;
  const invitation =
    parsed.success && preview
      ? { token: parsed.data, email: preview.email, organizationName: preview.organizationName }
      : undefined;
  return (
    <AuthCard title="Create your account">
      {googleSignInEnabled() && !invitation ? (
        <GoogleSignIn note="You choose worker or employer and accept the legal documents in the next step." />
      ) : null}
      <SignupForm documents={documents} attestationWording={attestationWording} invitation={invitation} />
    </AuthCard>
  );
}
