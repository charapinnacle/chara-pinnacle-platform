import { CircleAlert, CircleCheck, CircleX, Clock } from "lucide-react";
import { COMPLAINTS_SLUG, TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { ReviewChecks } from "@/components/onboarding/review-checks";
import type { ReviewOutcome } from "@/lib/dal/partner-review";
import { cn } from "@/lib/utils";
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

const decidedIcons = {
  info_requested: { icon: CircleAlert, tone: "bg-warning-background text-warning-foreground" },
  listed: { icon: CircleCheck, tone: "bg-success-background text-success-foreground" },
  declined: { icon: CircleX, tone: "bg-muted text-muted-foreground" },
} as const;

function DecidedIcon({ status }: { status: keyof typeof decidedIcons }) {
  const { icon: Icon, tone } = decidedIcons[status];
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone)}>
      <Icon className="size-5" />
    </span>
  );
}

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
      {canManage ? "Update your workforce profile" : "See your workforce profile"}
    </TextLink>
  );
  return awaitingReview(status) ? (
    <Card as="section" padding="lg" aria-labelledby="review-heading" className="gap-5 border-warning-border bg-warning-background">
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-warning-foreground">
          <Clock className="size-5" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 id="review-heading" className="text-h3">
            Your company is waiting for review
          </h2>
          <p className="text-body text-muted-foreground">
            Our team is reviewing {organization.displayName}. A review usually takes {reviewTimeText(targetDays)}.{" "}
            {wasListed
              ? "Your company stays listed while our team reviews the change."
              : "Until it is done, your company is not shown to employers."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 sm:ps-14">
        <ReviewChecks id="dashboard-review-checks" compact />
        {profileLink}
      </div>
    </Card>
  ) : (
    <Card as="section" padding="lg" aria-labelledby="review-heading" className="gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <DecidedIcon status={status} />
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 id="review-heading" className="text-h3">
            {decided[status].title}
          </h2>
          <p className="text-body text-muted-foreground">
            {status === "info_requested" && outcome?.infoStep
              ? `Check ${infoStepLabels[outcome.infoStep]}, then submit your company again.`
              : decided[status].text}
            {status === "info_requested" && wasListed ? " Your company stays listed meanwhile." : ""}
          </p>
        </div>
        {status === "info_requested" && canManage ? (
          <TextLink standalone href={onboardingPath(lang)}>
            Review and submit again
          </TextLink>
        ) : status === "declined" ? (
          // The same redress route as the decline email (NFR-C7, V78 review).
          <TextLink standalone href={`/${lang}/legal/${COMPLAINTS_SLUG}`}>
            How to appeal this decision
          </TextLink>
        ) : status === "info_requested" ? null : (
          profileLink
        )}
      </div>
      {outcome && status === "info_requested" ? <StaffMessage outcome={outcome} label="Message from our team" /> : null}
      {outcome && status === "declined" ? <StaffMessage outcome={outcome} label="Reason" /> : null}
    </Card>
  );
}
