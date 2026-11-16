import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";
import { ReviewChecks } from "@/components/onboarding/review-checks";
import { SubmitForReview } from "@/components/onboarding/submit-for-review";
import { WelcomeTiles } from "@/components/onboarding/welcome-tiles";
import { homePath, partnerStepPath, whatYouOfferPath, whereYouServePath, workforceProfilePath } from "@/lib/routes";
import {
  infoStepIndex,
  infoStepLabels,
  reviewTimeText,
  type InfoStep,
} from "@/lib/validation/partner-review";

type Organization = { slug: string; displayName: string };

// Where a request for information about a step leads (FR-J4 AC7): the step itself, reopened.
const reopenLinks = {
  company: (lang: string) => ({ href: partnerStepPath(lang, "company"), label: "Change your company details" }),
  where_you_serve: (lang: string) => ({ href: whereYouServePath(lang), label: "Change where you serve" }),
  commitments: (lang: string) => ({ href: partnerStepPath(lang, "commitments"), label: "Review the commitment" }),
} as const satisfies Record<InfoStep, (lang: string) => { href: string; label: string }>;

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
};

// Ready, the last step of partner onboarding (FR-J1 AC10, AC11): what staff check, how long it takes, and the submission
// by the owner or an admin. After a request for information it names the step staff reopened and links to it.
export function PartnerReadyStep({ lang, organization, manager, targetDays, infoRequested, infoStep, message }: PartnerReadyStepProps) {
  const reopen = infoStep ? reopenLinks[infoStep](lang) : null;
  return (
    <OnboardingPanel
      steps={<OnboardingSteps kind="partner" current={4} reopened={infoStep ? infoStepIndex[infoStep] : undefined} />}
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
      <ReviewChecks id="review-checks" />
      {manager ? (
        <SubmitForReview slug={organization.slug} again={infoRequested} />
      ) : (
        <Notice tone="info" role="status">
          The owner or an admin of {organization.displayName} submits the company for review.
        </Notice>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {manager ? (
          <>
            <TextLink standalone href={partnerStepPath(lang, "company")}>
              Change your company details
            </TextLink>
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

type PartnerReviewPendingProps = { lang: string; organization: Organization; targetDays: number; wasListed: boolean };

// The Ready step once the company is in the staff queue (FR-J1 AC11): it says the company is being reviewed, how long that
// usually takes and what staff check, and offers what can be done meanwhile. Never "approved" or "verified" (decision
// 2.6). Choosing a plan and inviting the team are not offered yet: the billing page of a partner comes with V15 and no
// team page is open to partners.
export function PartnerReviewPending({ lang, organization, targetDays, wasListed }: PartnerReviewPendingProps) {
  return (
    <OnboardingPanel
      steps={<OnboardingSteps kind="partner" current={4} />}
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
            { href: homePath(lang, "company"), title: "Go to your dashboard", text: "See where your review stands." },
          ]}
        />
        <p className="text-small text-muted-foreground">
          Choosing a plan and inviting your team open here once plans for recruitment and staffing companies are available.
        </p>
      </section>
    </OnboardingPanel>
  );
}
