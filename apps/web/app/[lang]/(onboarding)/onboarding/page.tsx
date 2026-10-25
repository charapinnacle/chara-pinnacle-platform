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
import { WhereYouServeForm } from "@/components/organization/where-you-serve-form";
import { WorkforceOfferForm } from "@/components/organization/workforce-offer-form";
import { CreatePassportForm } from "@/components/passport/create-passport-form";
import { commitAccountKind } from "@/lib/actions/consents";
import { geographiesComplete, getMarketsLimit, getOrganizationGeographies } from "@/lib/dal/geographies";
import { getOnboardingDocuments, getSignUpForm } from "@/lib/dal/legal";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganization, getOrganizationProfile } from "@/lib/dal/organizations";
import { getPassport } from "@/lib/dal/passport";
import { getInvitationPreview } from "@/lib/dal/team";
import { getCountries, getIndustries, getLanguages, getOccupations, type ReferenceItem } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import {
  getOccupationsLimit,
  getWorkforceOffer,
  workforceOfferComplete,
  workforceOfferDefaults,
} from "@/lib/dal/workforce-offer";
import { countryFromAcceptLanguage } from "@/lib/i18n/locale";
import { pendingInvitationToken } from "@/lib/invitation-cookie";
import { billingPath, homePath, onboardingPath, whatYouOfferPath, whereYouServePath } from "@/lib/routes";
import { BRAND_NAME } from "@/lib/brand";
import { partnerTypeSchema, type PartnerType } from "@/lib/validation/sign-up";

export const metadata: Metadata = { title: "Welcome" };

const kindLabel = { worker: "Worker", company: "Employer" } as const;

// The first step that is not done yet: a person who left half-way and comes back lands on it. An owner who created the
// company but has no authenticator yet continues with the two-step set-up. A recruitment or staffing company (FR-J1)
// goes Company, Where you serve (the countries, then what it offers), Commitments, Security, Ready; after Where you serve
// it waits on Commitments, from where ?step=where-you-serve reopens the countries and ?step=what-you-offer the offer.
export default async function OnboardingPage({
  params,
  searchParams,
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
      const { step } = await searchParams;
      return (
        <PartnerNextStep
          lang={lang}
          organization={{ ...organization, type: organization.type }}
          countries={countries}
          reopen={step === "where-you-serve" || step === "what-you-offer" ? step : null}
        />
      );
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

// The parts of the step Where you serve that ?step= reopens once they are done.
type PartnerStep = "where-you-serve" | "what-you-offer";

type PartnerNextStepProps = {
  lang: string;
  organization: { id: string; slug: string; displayName: string; type: PartnerType; role: string };
  countries: ReferenceItem[];
  reopen: PartnerStep | null;
};

// The steps after Company for a partner: Where you serve (FR-K1) until both lists hold a country, then What you offer
// (FR-K2) until it names an occupation and the recruitment type, both within the step Where you serve of the indicator;
// then the Commitments step, which is built next (V08); until then that page says what comes and that nothing is lost.
// Only the owner or an admin saves; while release 2a is off the step stays closed.
async function PartnerNextStep({ lang, organization, countries, reopen }: PartnerNextStepProps) {
  if (!(await isReleased("release_partner_directories"))) {
    return (
      <StepPending lang={lang} current={1} title="Next: Where you serve">
        This step is not open yet. {organization.displayName} is saved, and your company is not listed until you finish
        onboarding and our team has reviewed it. Come back to this page to continue.
      </StepPending>
    );
  }
  const member = organization.role === "member";
  const [geographies, offer] = await Promise.all([
    getOrganizationGeographies(organization.id),
    getWorkforceOffer(organization.id),
  ]);
  const geographiesDone = geographiesComplete(geographies);
  const offerDone = workforceOfferComplete(organization.type, offer);
  if (member && !(geographiesDone && offerDone)) {
    return (
      <StepPending lang={lang} current={1} title={geographiesDone ? "Next: What you offer" : "Next: Where you serve"}>
        The owner or an admin of {organization.displayName}{" "}
        {geographiesDone ? "chooses what you offer" : "chooses the countries where you serve"}. Come back to this page when
        they have.
      </StepPending>
    );
  }

  if (!geographiesDone || (!member && reopen === "where-you-serve")) {
    const [profile, marketsLimit] = await Promise.all([
      getOrganizationProfile(organization.id),
      getMarketsLimit(organization.id),
    ]);
    const basedIn = countries.find(({ code }) => code === profile?.country)?.name ?? profile?.country ?? "";
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="partner" current={1} />}
        title="Where you serve"
        description="Employers and job orders reach you through these countries, not through your address. Choose them from the list."
      >
        <WhereYouServeForm
          slug={organization.slug}
          partnerType={organization.type}
          basedIn={basedIn}
          countries={countries}
          defaults={geographies}
          marketsLimit={marketsLimit}
          billingHref={billingPath(lang, organization.slug)}
          onboarding
        />
      </OnboardingPanel>
    );
  }

  if (!offerDone || (!member && reopen === "what-you-offer")) {
    const [occupationsLimit, occupations, industries, languages] = await Promise.all([
      getOccupationsLimit(organization.id),
      getOccupations(),
      getIndustries(),
      getLanguages(),
    ]);
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="partner" current={1} />}
        title="What you offer"
        description="Employers, job orders and the directories find you by the occupations you recruit or supply. Choose them from the list."
      >
        <WorkforceOfferForm
          slug={organization.slug}
          partnerType={organization.type}
          occupations={occupations}
          industries={industries}
          languages={languages}
          defaults={workforceOfferDefaults(offer)}
          occupationsLimit={occupationsLimit}
          billingHref={billingPath(lang, organization.slug)}
          onboarding
        />
      </OnboardingPanel>
    );
  }

  return (
    <StepPending
      lang={lang}
      current={2}
      title="Next: Commitments"
      description={`${organization.displayName}, the countries where you serve and what you offer are saved. In the next step you accept the commitments every partner makes, such as never charging workers a fee.`}
      changeLinks={!member}
    >
      This step is not open yet. Your details are saved, and your company is not listed until you finish onboarding and our
      team has reviewed it. Come back to this page to continue.
    </StepPending>
  );
}

type StepPendingProps = {
  lang: string;
  current: number;
  title: string;
  description?: string;
  // The links that reopen Where you serve and What you offer, for the owner or an admin.
  changeLinks?: boolean;
  children: React.ReactNode;
};

// A step of the partner journey that is not built yet, or that someone else completes.
function StepPending({ lang, current, title, description, changeLinks = false, children }: StepPendingProps) {
  return (
    <OnboardingPanel steps={<OnboardingSteps kind="partner" current={current} />} title={title} description={description}>
      <Notice tone="info" role="status">
        {children}
      </Notice>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {changeLinks ? (
          <>
            <TextLink standalone href={whereYouServePath(lang)}>
              Change where you serve
            </TextLink>
            <TextLink standalone href={whatYouOfferPath(lang)}>
              Change what you offer
            </TextLink>
          </>
        ) : null}
        <TextLink standalone href={`/${lang}`}>
          Go to the home page
        </TextLink>
      </div>
    </OnboardingPanel>
  );
}
