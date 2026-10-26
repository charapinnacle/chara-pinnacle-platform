import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { ReviewChecks } from "@/components/onboarding/review-checks";
import type { ReviewOutcome } from "@/lib/dal/partner-review";
import { onboardingPath, workforceProfilePath } from "@/lib/routes";
import { awaitingReview, infoStepLabels, reviewTimeText, type ReviewStatus } from "@/lib/validation/partner-review";

type PartnerReviewCardProps = {
  lang: string;
  organization: { slug: string; displayName: string };
  status: Exclude<ReviewStatus, "onboarding">;
  // The company was listed before: it stays listed during a re-review and while asked for information in one.
  wasListed: boolean;
  outcome: ReviewOutcome | null;
  targetDays: number;
  // Only the owner and admins submit the company again or complete the profile; a member reads the state.
  canManage: boolean;
};

const decided = {
  info_requested: {
    title: "Our team asked for more information",
    text: "Check the step our team named, then submit your company again.",
  },
  listed: { title: "Your company is listed", text: "Employers can find it in the partner directories." },
  declined: { title: "Your company is not listed", text: "Our team decided not to list it in the partner directories." },
} as const;

// The message staff wrote with a request for information or a decline (FR-J4 AC7, NFR-C7), as the company reads it.
function StaffMessage({ outcome, label }: { outcome: ReviewOutcome; label: string }) {
  if (!outcome.reason) return null;
  return (
    <div className="grid gap-1">
      <h3 className="text-h3">{label}</h3>
      <p className="text-body whitespace-pre-line break-words">{outcome.reason}</p>
    </div>
  );
}

// The review and listing state of a recruitment or staffing company on its dashboard (FR-J1 AC11, FR-J4, FR-R3, FR-R4):
// the state of the review, the message of our team after a decision and what to do next. Each decision is also emailed
// (partner_approved, partner_info_requested, partner_declined). Never "approved" or "verified" (decision 2.6).
export function PartnerReviewCard({ lang, organization, status, wasListed, outcome, targetDays, canManage }: PartnerReviewCardProps) {
  const profileLink = (
    <TextLink standalone href={workforceProfilePath(lang, organization.slug)}>
      {canManage ? "Complete your workforce profile" : "See your workforce profile"}
    </TextLink>
  );
  return awaitingReview(status) ? (
    <Card as="section" padding="lg" aria-labelledby="review-heading" className="gap-6">
      <div className="grid gap-2">
        <h2 id="review-heading" className="text-h2">
          Your company is waiting for review
        </h2>
        <p className="text-body text-muted-foreground">
          Our team is reviewing {organization.displayName}. A review usually takes {reviewTimeText(targetDays)}.{" "}
          {wasListed
            ? "Your company stays listed while our team reviews the change."
            : "Until it is done, your company is not shown to employers."}
        </p>
      </div>
      <ReviewChecks id="dashboard-review-checks" />
      {profileLink}
    </Card>
  ) : (
    <Card as="section" padding="lg" aria-labelledby="review-heading" className="gap-4">
      <h2 id="review-heading" className="text-h2">
        {decided[status].title}
      </h2>
      <p className="text-body text-muted-foreground">
        {status === "info_requested" && outcome?.infoStep
          ? `Check ${infoStepLabels[outcome.infoStep]}, then submit your company again.`
          : decided[status].text}
        {status === "info_requested" && wasListed ? " Your company stays listed meanwhile." : ""}
      </p>
      {outcome && status === "info_requested" ? <StaffMessage outcome={outcome} label="Message from our team" /> : null}
      {outcome && status === "declined" ? <StaffMessage outcome={outcome} label="Reason" /> : null}
      {status === "info_requested" && canManage ? (
        <TextLink standalone href={onboardingPath(lang)}>
          Review and submit again
        </TextLink>
      ) : status === "declined" ? (
        <TextLink standalone href={`/${lang}/contact`}>
          Contact us about this decision
        </TextLink>
      ) : status === "info_requested" ? null : (
        profileLink
      )}
    </Card>
  );
}
