import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import { ChooseKindForm } from "@/components/consent/choose-kind-form";
import { CommitKind } from "@/components/consent/commit-kind";
import { ConsentForm } from "@/components/consent/consent-form";
import { Notice } from "@/components/forms/notice";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { TextLink } from "@/components/forms/text-link";
import { EnrolmentStartForm } from "@/components/mfa/enrolment-start-form";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";
import { PartnerReadyStep, PartnerReviewPending } from "@/components/onboarding/partner-ready";
import { CommitmentDocument } from "@/components/organization/commitment-document";
import { CommitmentForm } from "@/components/organization/commitment-form";
import { OrganizationForm } from "@/components/organization/organization-form";
import { ProfileForm } from "@/components/organization/profile-form";
import { WhereYouServeForm } from "@/components/organization/where-you-serve-form";
import { WorkforceOfferForm } from "@/components/organization/workforce-offer-form";
import { CreatePassportForm } from "@/components/passport/create-passport-form";
import { commitAccountKind } from "@/lib/actions/consents";
import { geographiesComplete, getOrganizationGeographies } from "@/lib/dal/geographies";
import { getBillingState } from "@/lib/dal/billing";
import { getCommitmentStatus } from "@/lib/dal/commitment";
import { getLegalDocument, getOnboardingDocuments, getSignUpForm } from "@/lib/dal/legal";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganization, getOrganizationProfile } from "@/lib/dal/organizations";
import { getPartnerReview, getReviewOutcome, getReviewTargetDays } from "@/lib/dal/partner-review";
import { getPassport } from "@/lib/dal/passport";
import { getInvitationPreview } from "@/lib/dal/team";
import { getCountries, getIndustries, getLanguages, getOccupations, type ReferenceItem } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { getUsagePrompts } from "@/lib/dal/usage";
import { getWorkforceOffer, workforceOfferComplete, workforceOfferDefaults } from "@/lib/dal/workforce-offer";
import { countryFromAcceptLanguage } from "@/lib/i18n/locale";
import { pendingInvitationToken } from "@/lib/invitation-cookie";
import {
  billingPath,
  homePath,
  mfaPath,
  onboardingPath,
  partnerStepPath,
  whatYouOfferPath,
  whereYouServePath,
} from "@/lib/routes";
import { BRAND_NAME } from "@/lib/brand";
import { COMMITMENT_SLUG, commitmentOutdated, WORKERS_NEVER_PAY } from "@/lib/validation/commitment";
import { identifierKindLabels } from "@/lib/validation/organization";
import { awaitingReview, infoStepIndex, submittable } from "@/lib/validation/partner-review";
import { partnerTypeSchema, type PartnerType } from "@/lib/validation/sign-up";

export const metadata: Metadata = { title: "Welcome" };

const kindLabel = { worker: "Worker", company: "Employer" } as const;

// The first step that is not done yet: a person who left half-way and comes back lands on it. An owner who created the
// company but has no authenticator yet continues with the two-step set-up. A recruitment or staffing company (FR-J1)
// goes Company, Where you serve (the countries, then what it offers), Commitments, Security, Ready (PartnerNextStep).
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
      const requested = partnerStepSchema.safeParse(step);
      return (
        <PartnerNextStep
          lang={lang}
          aal={user.aal}
          organization={{ ...organization, type: organization.type }}
          countries={countries}
          industries={industries}
          step={requested.success ? requested.data : null}
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
    // A person who registered from a team invitation joins that team instead of creating a company (FR-A5, and FR-J1 for
    // the team of a recruitment or staffing company).
    const invitation = await pendingInvitationToken();
    const preview = invitation ? await getInvitationPreview(invitation) : null;
    if (
      invitation &&
      preview &&
      preview.email.toLowerCase() === user.email?.toLowerCase() &&
      preview.organizationType === (user.intendedOrganizationType ?? "employer")
    ) {
      redirect(`/${lang}/invitations/${invitation}`);
    }
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

// The steps a partner opens by their address once they are done (?step=): the countries and the offer of Where you
// serve, the company details, Commitments, and Ready, which needs every earlier step.
const partnerStepSchema = z.enum(["where-you-serve", "what-you-offer", "company", "commitments", "ready"]);

type PartnerStep = z.infer<typeof partnerStepSchema>;

type PartnerNextStepProps = {
  lang: string;
  aal: "aal1" | "aal2";
  organization: { id: string; slug: string; displayName: string; type: PartnerType; role: string };
  countries: ReferenceItem[];
  industries: ReferenceItem[];
  step: PartnerStep | null;
};

// The steps after Company for a partner (FR-J1 AC8): Where you serve (FR-K1) until both lists hold a country, then What
// you offer (FR-K2) until it names an occupation and the recruitment type, both within the step Where you serve of the
// indicator; then Commitments (FR-J3), where the owner alone accepts the employer-pays commitment and an admin or a
// member reads it; then Security, where the owner and each admin set up two-step verification (a member is not asked);
// then Ready, where the owner or an admin submits the company for review, and which shows the pending state once it is
// in the staff queue. A partner who comes back lands on the first step not done; the address of Ready leads there while
// an earlier step is open. After a request for information (info_requested, FR-J4) Ready names the step staff reopened and
// shows their message.
// Only the owner or an admin saves the details; while release 2a is off the steps stay closed.
async function PartnerNextStep({ lang, aal, organization, countries, industries, step }: PartnerNextStepProps) {
  if (!(await isReleased("release_partner_directories"))) {
    return (
      <StepPending lang={lang} current={1} title="Next: Where you serve">
        This step is not open yet. {organization.displayName} is saved, and your company is not listed until you finish
        onboarding and our team has reviewed it. Come back to this page to continue.
      </StepPending>
    );
  }
  const review = await getPartnerReview(organization.id);
  if (!review) throw new Error("A partner organisation has no review state");
  if (!submittable(review.status)) {
    // A listed or declined partner is past onboarding: its dashboard says where it stands.
    if (!awaitingReview(review.status)) redirect(homePath(lang, "company"));
    return (
      <PartnerReviewPending
        lang={lang}
        organization={organization}
        targetDays={await getReviewTargetDays()}
        wasListed={review.listedAt !== null}
        manager={organization.role !== "member"}
      />
    );
  }

  const member = organization.role === "member";
  const [geographies, offer, commitment, twoStepDone] = await Promise.all([
    getOrganizationGeographies(organization.id),
    getWorkforceOffer(organization.id),
    getCommitmentStatus(organization.id),
    member ? true : hasVerifiedTotpFactor(lang),
  ]);
  const geographiesDone = geographiesComplete(geographies);
  const offerDone = workforceOfferComplete(organization.type, offer);
  if (step === "ready" && !(geographiesDone && offerDone && commitment.accepted && twoStepDone)) redirect(onboardingPath(lang));
  const reopened = review.status === "info_requested" && review.infoStep ? infoStepIndex[review.infoStep] : undefined;

  if (member && !(geographiesDone && offerDone)) {
    return (
      <StepPending lang={lang} current={1} title={geographiesDone ? "Next: What you offer" : "Next: Where you serve"}>
        The owner or an admin of {organization.displayName}{" "}
        {geographiesDone ? "chooses what you offer" : "chooses the countries where you serve"}. Come back to this page when
        they have.
      </StepPending>
    );
  }

  // The company details are edited with update_organization_profile, which needs aal2 like every change of them.
  if (!member && step === "company") {
    if (aal !== "aal2") redirect(mfaPath(lang, partnerStepPath(lang, "company")));
    const [profile, billing] = await Promise.all([getOrganizationProfile(organization.id), getBillingState(organization.id)]);
    if (!profile) throw new Error("The organisation has no profile");
    // The identifier is shown only, as on the profile page of an employer: the owner records it on the billing page, which
    // a partner gets with V15, so until then a correction goes through support.
    const identifier = billing.identifier
      ? `${identifierKindLabels[billing.identifier_kind ?? ""] ?? "Identifier"}: ${billing.identifier}.`
      : "No company registration number or VAT number is recorded yet.";
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="partner" current={0} />}
        title="Your company details"
        description="Our team checks these details in the review."
      >
        <ProfileForm
          slug={organization.slug}
          defaults={profile}
          legalNameLocked={billing.identifier_locked}
          countries={countries}
          industries={industries}
          partner
        />
        <section aria-labelledby="identifier-heading" className="grid gap-2">
          <h2 id="identifier-heading" className="text-h2">
            Company identifier
          </h2>
          <p className="text-body text-muted-foreground">
            {identifier}{" "}
            {billing.identifier_locked
              ? "It cannot be changed once a payment has been started for the company."
              : "The owner corrects it on the billing page, or contact support."}
          </p>
        </section>
        <TextLink standalone href={partnerStepPath(lang, "ready")}>
          Back to Ready
        </TextLink>
      </OnboardingPanel>
    );
  }

  if (!geographiesDone || (!member && step === "where-you-serve")) {
    const [profile, prompts] = await Promise.all([
      getOrganizationProfile(organization.id),
      getUsagePrompts(organization.id, organization.type, ["markets"]),
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
          organizationId={organization.id}
          partnerType={organization.type}
          basedIn={basedIn}
          countries={countries}
          defaults={geographies}
          marketsPrompt={prompts.markets}
          billingHref={billingPath(lang, organization.slug)}
          onboarding
        />
      </OnboardingPanel>
    );
  }

  if (!offerDone || (!member && step === "what-you-offer")) {
    const [prompts, occupations, languages] = await Promise.all([
      getUsagePrompts(organization.id, organization.type, ["listed_occupations"]),
      getOccupations(),
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
          organizationId={organization.id}
          partnerType={organization.type}
          occupations={occupations}
          industries={industries}
          languages={languages}
          defaults={workforceOfferDefaults(offer)}
          occupationsPrompt={prompts.listed_occupations}
          billingHref={billingPath(lang, organization.slug)}
          onboarding
        />
      </OnboardingPanel>
    );
  }

  if (!commitment.accepted || step === "commitments") {
    const document = await getLegalDocument(COMMITMENT_SLUG);
    if (!document) throw new Error("The employer-pays commitment has no published version");
    const outdated = commitmentOutdated(commitment);
    const owner = organization.role === "owner";
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="partner" current={2} />}
        title="Commitments"
        description={
          commitment.accepted
            ? `${organization.displayName} has accepted the employer-pays commitment. ${WORKERS_NEVER_PAY}.`
            : outdated
              ? `The employer-pays commitment has changed since ${organization.displayName} accepted it. ${WORKERS_NEVER_PAY}, so every recruitment and staffing company accepts the current version.`
              : `${WORKERS_NEVER_PAY}. Every recruitment and staffing company commits to this before it is listed.`
        }
      >
        {document.isDraft ? (
          <Notice role="note" tone="info">
            Draft - not yet approved by legal counsel. The commitment below is a draft; you accept the version shown.
          </Notice>
        ) : null}
        <CommitmentDocument document={document} outdated={outdated} />
        {commitment.accepted ? null : owner ? (
          <CommitmentForm slug={organization.slug} version={document.version} />
        ) : (
          <Notice tone="info" role="status">
            Only the owner of {organization.displayName} can accept the commitment. Ask them to sign in and accept it, then
            come back to this page.
          </Notice>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {member ? null : (
            <>
              <TextLink standalone href={whereYouServePath(lang)}>
                Change where you serve
              </TextLink>
              <TextLink standalone href={whatYouOfferPath(lang)}>
                Change what you offer
              </TextLink>
            </>
          )}
          {commitment.accepted ? (
            <TextLink standalone href={partnerStepPath(lang, "ready")}>
              Back to Ready
            </TextLink>
          ) : (
            <TextLink standalone href={`/${lang}`}>
              Go to the home page
            </TextLink>
          )}
        </div>
      </OnboardingPanel>
    );
  }

  if (!twoStepDone) {
    return (
      <OnboardingPanel
        steps={<OnboardingSteps kind="partner" current={3} />}
        title="Secure your account"
        description={`As ${organization.role === "owner" ? "the owner" : "an admin"} of ${organization.displayName} you will manage its team, billing, job orders and candidates, so ${BRAND_NAME} asks for a code from an authenticator app before you open them. It takes about a minute.`}
      >
        <p className="text-body leading-relaxed">
          You scan a QR code with an authenticator app such as Google Authenticator, 1Password or Authy, then enter the code it
          shows.
        </p>
        <EnrolmentStartForm first next={onboardingPath(lang)} />
      </OnboardingPanel>
    );
  }

  const [targetDays, outcome] = await Promise.all([
    getReviewTargetDays(),
    review.status === "info_requested" ? getReviewOutcome(organization.id) : null,
  ]);
  return (
    <PartnerReadyStep
      lang={lang}
      organization={organization}
      manager={!member}
      targetDays={targetDays}
      infoRequested={review.status === "info_requested"}
      infoStep={reopened === undefined ? null : review.infoStep}
      message={outcome?.decision === "request_info" ? outcome.reason : null}
    />
  );
}

type StepPendingProps = {
  lang: string;
  current: number;
  title: string;
  children: React.ReactNode;
};

// A step of the partner journey that is not open yet, or that someone else completes.
function StepPending({ lang, current, title, children }: StepPendingProps) {
  return (
    <OnboardingPanel steps={<OnboardingSteps kind="partner" current={current} />} title={title}>
      <Notice tone="info" role="status">
        {children}
      </Notice>
      <TextLink standalone href={`/${lang}`}>
        Go to the home page
      </TextLink>
    </OnboardingPanel>
  );
}
