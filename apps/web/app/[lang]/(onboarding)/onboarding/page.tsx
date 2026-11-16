import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChooseKindForm } from "@/components/consent/choose-kind-form";
import { CommitKind } from "@/components/consent/commit-kind";
import { ConsentForm } from "@/components/consent/consent-form";
import { Notice } from "@/components/forms/notice";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { TextLink } from "@/components/forms/text-link";
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
import { BRAND_NAME } from "@/lib/brand";
import { partnerTypeSchema } from "@/lib/validation/sign-up";

export const metadata: Metadata = { title: "Welcome" };

const kindLabel = { worker: "Worker", company: "Employer" } as const;

// The first step that is not done yet: a person who left half-way and comes back lands on it. An owner who created the
// company but has no authenticator yet continues with the two-step set-up. A recruitment or staffing company (FR-J1)
// goes Company, Where you serve, Commitments, Security, Ready; after the Company step it waits on Where you serve.
export default async function OnboardingPage({
  params,
}: PageProps<"/[lang]/onboarding">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  const partnerType = partnerTypeSchema.safeParse(user.intendedOrganizationType);

  if (user.accountKind === "company") {
    const [organization, countries, industries] = await Promise.all([
      getMyOrganization(user.id),
      getCountries(),
      getIndustries(),
    ]);
    if (organization?.type === "recruitment_company" || organization?.type === "staffing_company") {
      return <WhereYouServePending lang={lang} companyName={organization.displayName} />;
    }
    if (organization) {
      const ownerWithoutTwoStep = organization.role === "owner" && !(await hasVerifiedTotpFactor(lang));
      redirect(ownerWithoutTwoStep ? onboardingPath(lang, "security") : homePath(lang, "company"));
    }
    const defaultCountry = countryFromAcceptLanguage(
      (await headers()).get("accept-language"),
      countries.map(({ code }) => code),
    );
    if (partnerType.success) {
      return (
        <OnboardingPanel
          steps={<OnboardingSteps kind="partner" current={0} />}
          title="Tell us about your company"
          description="Our team reviews these details before your company is listed. You can edit most of them later."
        >
          <OrganizationForm
            lang={lang}
            countries={countries}
            industries={industries}
            defaultCountry={defaultCountry}
            partnerType={partnerType.data}
          />
        </OnboardingPanel>
      );
    }
    const invitation = await pendingInvitationToken();
    const preview = invitation ? await getInvitationPreview(invitation) : null;
    if (invitation && preview?.email.toLowerCase() === user.email?.toLowerCase()) {
      redirect(`/${lang}/invitations/${invitation}`);
    }
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
        description={`Tell us how you will use ${BRAND_NAME} and accept the documents for it to finish creating your account.`}
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
      title={`Set up your ${partnerType.success ? partnerTypeLabels[partnerType.data] : kindLabel[user.intendedAccountKind]} account`}
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

// The step after Company for a partner. Where you serve is built next (V06); until then the page says what comes and that
// nothing is lost, instead of sending the partner to a dashboard it cannot use yet.
function WhereYouServePending({ lang, companyName }: { lang: string; companyName: string }) {
  return (
    <OnboardingPanel
      steps={<OnboardingSteps kind="partner" current={1} />}
      title="Next: Where you serve"
      description={`${companyName} is saved. In the next step you tell us which countries you recruit from and which markets you serve.`}
    >
      <Notice tone="info" role="status">
        This step is not open yet. Your company details are saved, and your company is not listed until you finish onboarding
        and our team has reviewed it. Come back to this page to continue.
      </Notice>
      <TextLink standalone href={`/${lang}`}>
        Go to the home page
      </TextLink>
    </OnboardingPanel>
  );
}
