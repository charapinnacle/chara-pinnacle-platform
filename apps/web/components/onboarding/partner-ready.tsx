import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { ReviewChecks } from "@/components/onboarding/review-checks";
import { SubmitForReview } from "@/components/onboarding/submit-for-review";
import { WelcomeTiles } from "@/components/onboarding/welcome-tiles";
import {
  billingPath,
  homePath,
  membersPath,
  partnerStepPath,
  whatYouOfferPath,
  whereYouServePath,
  workforceProfilePath,
} from "@/lib/routes";
import {
  infoStepIndexes,
  infoStepLabels,
  reviewTimeText,
  type InfoStep,
} from "@/lib/validation/partner-review";

type Organization = { slug: string; displayName: string };

// Where a request for information about a step leads (FR-J4 AC7): the step itself, reopened, or for the licences their
// section of the workforce profile.
const reopenLinks = {
  company: (lang: string) => ({ href: partnerStepPath(lang, "company"), label: "Change your company details" }),
  where_you_serve: (lang: string) => ({ href: whereYouServePath(lang), label: "Change where you serve" }),
  commitments: (lang: string) => ({ href: partnerStepPath(lang, "commitments"), label: "Review the commitment" }),
  licences: (lang: string, slug: string) => ({ href: licencesPath(lang, slug), label: "Update your licences" }),
} as const satisfies Record<InfoStep, (lang: string, slug: string) => { href: string; label: string }>;

function licencesPath(lang: string, slug: string): string {
  return `${workforceProfilePath(lang, slug)}#licences-heading`;
}

type PartnerReadyStepProps = {
  lang: string;
  organization: Organization;
  // The owner or an admin submits; a member reads the step.
  manager: boolean;
  targetDays: number;
  // Staff asked for more information (review_status info_requested), about this step when they named one.
  infoRequested: boolean;
  infoStep: InfoStep | null;
  // What our team wrote with the request (FR-J4 AC7).
  message: string | null;
  // A staffing company's available workforce (FR-K3), listed before it submits: occupations, numbers and source countries.
  availability?: React.ReactNode;
};

// Ready, the last step of partner onboarding (FR-J1 AC10, AC11): what staff check, how long it takes, and the submission
// by the owner or an admin. After a request for information it names the step staff reopened and links to it.
export function PartnerReadyStep({
  lang,
  organization,
  manager,
  targetDays,
  infoRequested,
  infoStep,
  message,
  availability,
}: PartnerReadyStepProps) {
  const reopen = infoStep ? reopenLinks[infoStep](lang, organization.slug) : null;
  return (
    <OnboardingPanel
      partnerStep={{ current: 5, reopened: infoStep ? infoStepIndexes[infoStep] : undefined }}
      title={infoRequested ? "Submit your company again" : "Submit your company for review"}
      description={`Our team reviews ${organization.displayName} before it is listed in the partner directories. A review usually takes ${reviewTimeText(targetDays)}.`}
    >
      {infoRequested ? (
        <Notice tone="warning" role="status">
          <p>
            Our team asked for more information about {infoStep ? infoStepLabels[infoStep] : "your company"}. Check and update{" "}
            {infoStep ? "that step" : "your details"}, then submit your company again.
          </p>
          {message ? (
            <>
              <p className="mt-2 font-medium">Message from our team</p>
              <p className="whitespace-pre-line break-words">{message}</p>
            </>
          ) : null}
          {manager && reopen ? (
            <TextLink href={reopen.href} className="mt-2 inline-block">
              {reopen.label}
            </TextLink>
          ) : null}
        </Notice>
      ) : null}
      {availability ? (
        <Card as="section" padding="lg" elevated aria-labelledby="ready-availability-heading" className="gap-5">
          <div className="grid gap-1">
            <h2 id="ready-availability-heading" className="text-h3">
              Your available workforce
            </h2>
            <p className="text-body text-muted-foreground">
              The workers you can supply now, per occupation and source country, for example 40 welders from the Philippines.
              Employers find you by them. You can change them any time on your workforce profile.
            </p>
          </div>
          {availability}
        </Card>
      ) : null}
      <Card padding="lg" elevated className="gap-5">
        <ReviewChecks id="review-checks" />
        <p className="text-body">
          Licences are optional before you submit. Add the licence or registration you hold for each country where you work
          on your workforce profile, so our team can check it in the review.{" "}
          <TextLink href={licencesPath(lang, organization.slug)}>Add your licences</TextLink>
        </p>
        {manager ? (
          <SubmitForReview slug={organization.slug} again={infoRequested} />
        ) : (
          <Notice tone="info" role="status">
            The owner or an admin of {organization.displayName} submits the company for review.
          </Notice>
        )}
      </Card>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {manager
          ? [
              { href: partnerStepPath(lang, "company"), label: "Change your company details" },
              { href: whereYouServePath(lang), label: "Change where you serve" },
              { href: whatYouOfferPath(lang), label: "Change what you offer" },
            ]
              // The step staff reopened is linked in their notice already.
              .filter(({ href }) => href !== reopen?.href)
              .map(({ href, label }) => (
                <TextLink key={href} standalone href={href}>
                  {label}
                </TextLink>
              ))
          : null}
        <TextLink standalone href={`/${lang}`}>
          Go to the home page
        </TextLink>
      </div>
    </OnboardingPanel>
  );
}

type PartnerReviewPendingProps = {
  lang: string;
  organization: Organization;
  targetDays: number;
  wasListed: boolean;
  // The owner or an admin chooses the plan and invites the team; a member is offered the profile and the dashboard.
  manager: boolean;
};

// The Ready step once the company is in the staff queue (FR-J1 AC11): it says the company is being reviewed, how long that
// usually takes and what staff check, and offers what can be done meanwhile: the workforce profile, and for the owner and
// admins choosing a plan and inviting the team. Never "approved" or "verified" (decision 2.6).
export function PartnerReviewPending({ lang, organization, targetDays, wasListed, manager }: PartnerReviewPendingProps) {
  return (
    <OnboardingPanel
      partnerStep={{ current: 5 }}
      title="Your company is waiting for review"
      description={`Our team is reviewing ${organization.displayName}. A review usually takes ${reviewTimeText(targetDays)}. ${wasListed ? "Your company stays listed while our team reviews the change." : "Until it is done, your company is not shown to employers."}`}
    >
      <ReviewChecks id="review-checks" />
      <section aria-labelledby="next-heading" className="grid gap-3">
        <h2 id="next-heading" className="text-h3">
          What you can do now
        </h2>
        <WelcomeTiles
          tiles={[
            {
              href: workforceProfilePath(lang, organization.slug),
              title: "Complete your workforce profile",
              text: "Check the countries and occupations employers will find you by.",
            },
            ...(manager
              ? [
                  {
                    href: billingPath(lang, organization.slug),
                    title: "Choose a plan",
                    text: "Compare the plans for your company.",
                  },
                  {
                    href: membersPath(lang, organization.slug),
                    title: "Invite your team",
                    text: "Keep your profile and listings up to date together.",
                  },
                ]
              : []),
            { href: homePath(lang, "company"), title: "Go to your dashboard", text: "See where your review stands." },
          ]}
        />
      </section>
    </OnboardingPanel>
  );
}
