import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EnrolmentStartForm } from "@/components/mfa/enrolment-start-form";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganization } from "@/lib/dal/organizations";
import { requireUser } from "@/lib/dal/session";
import { homePath, onboardingPath } from "@/lib/routes";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Secure your account", robots: { index: false } };

// The owner's two-step set-up as a step of onboarding, after the company and before the welcome screen. The same set-up
// stays on /mfa for every other case (an administrator, a backup device, an owner who skipped this page).
export default async function OnboardingSecurityPage({ params }: PageProps<"/[lang]/onboarding/security">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "company") redirect(homePath(lang, user.accountKind));
  const [organization, twoStepDone] = await Promise.all([getMyOrganization(user.id), hasVerifiedTotpFactor(lang)]);
  if (!organization) redirect(onboardingPath(lang));
  if (organization.role !== "owner" || twoStepDone) redirect(homePath(lang, "company"));

  return (
    <OnboardingPanel
      steps={<OnboardingSteps kind="company" current={1} />}
      title="Secure your account"
      description={`As the owner you can see applicants' documents and your company's billing, so ${BRAND_NAME} asks for a code from an authenticator app before you open them. It takes about a minute.`}
    >
      <p className="text-body leading-relaxed">
        You scan a QR code with an authenticator app such as Google Authenticator, 1Password or Authy, then enter the code it
        shows.
      </p>
      <EnrolmentStartForm first next={onboardingPath(lang, "welcome")} />
    </OnboardingPanel>
  );
}
