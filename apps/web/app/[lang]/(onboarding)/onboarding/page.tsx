import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChooseKindForm } from "@/components/consent/choose-kind-form";
import { CommitKind } from "@/components/consent/commit-kind";
import { ConsentForm } from "@/components/consent/consent-form";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";
import { OrganizationForm } from "@/components/organization/organization-form";
import { CreatePassportForm } from "@/components/passport/create-passport-form";
import { commitAccountKind } from "@/lib/actions/consents";
import { getOnboardingDocuments, getSignUpForm } from "@/lib/dal/legal";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganization } from "@/lib/dal/organizations";
import { getPassport } from "@/lib/dal/passport";
import { getInvitationPreview } from "@/lib/dal/team";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { requireUser } from "@/lib/dal/session";
import { countryFromAcceptLanguage } from "@/lib/i18n/locale";
import { pendingInvitationToken } from "@/lib/invitation-cookie";
import { homePath, onboardingPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Welcome — CHARA" };

const kindLabel = { worker: "Worker", company: "Employer" } as const;

// The first step that is not done yet: a person who left half-way and comes back lands on it. An owner who created the
// company but has no authenticator yet continues with the two-step set-up.
export default async function OnboardingPage({
  params,
}: PageProps<"/[lang]/onboarding">) {
  const { lang } = await params;
  const user = await requireUser(lang);

  if (user.accountKind === "company") {
    const [organization, countries, industries] = await Promise.all([
      getMyOrganization(user.id),
      getCountries(),
      getIndustries(),
    ]);
    if (organization) {
      const ownerWithoutTwoStep = organization.role === "owner" && !(await hasVerifiedTotpFactor(lang));
      redirect(ownerWithoutTwoStep ? onboardingPath(lang, "security") : homePath(lang, "company"));
    }
    const invitation = await pendingInvitationToken();
    const preview = invitation ? await getInvitationPreview(invitation) : null;
    if (invitation && preview?.email.toLowerCase() === user.email?.toLowerCase()) {
      redirect(`/${lang}/invitations/${invitation}`);
    }
    const defaultCountry = countryFromAcceptLanguage(
      (await headers()).get("accept-language"),
      countries.map(({ code }) => code),
    );
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="company" current={0} />}
        title="Tell us about your company"
        description="This is how candidates see you. You can edit most of it later."
      >
        <OrganizationForm lang={lang} countries={countries} industries={industries} defaultCountry={defaultCountry} />
      </OnboardingPanel>
    );
  }

  if (user.accountKind === "worker") {
    const [passport, countries] = await Promise.all([getPassport(user.id), getCountries()]);
    if (passport) redirect(homePath(lang, "worker"));
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="worker" current={0} />}
        title="Create your CHARA Passport"
        description="One profile for every application. An employer sees it only when you apply to one of their jobs."
      >
        <CreatePassportForm countries={countries} />
      </OnboardingPanel>
    );
  }

  if (!user.intendedAccountKind) {
    const form = await getSignUpForm();
    return (
      <OnboardingPanel
        title="Choose your account type"
        description="Tell us how you will use CHARA and accept the documents for it to finish creating your account."
      >
        <ChooseKindForm documents={form.documents} attestationWording={form.attestationWording} />
      </OnboardingPanel>
    );
  }

  const { documents, attestationWording } = await getOnboardingDocuments(
    user.intendedAccountKind,
  );
  return (
    <OnboardingPanel
      title={`Set up your ${kindLabel[user.intendedAccountKind]} account`}
      description={
        documents.length === 0
          ? undefined
          : "A document you accepted at sign-up has changed, or was not recorded. Accept the current version to continue."
      }
    >
      {documents.length === 0 ? (
        <CommitKind />
      ) : (
        <ConsentForm
          documents={documents}
          attestationWording={attestationWording}
          submitLabel="Accept and continue"
          onAccept={commitAccountKind}
        />
      )}
    </OnboardingPanel>
  );
}
