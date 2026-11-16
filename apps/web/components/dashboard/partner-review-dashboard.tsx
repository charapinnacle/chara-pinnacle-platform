import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { ReviewChecks } from "@/components/onboarding/review-checks";
import { onboardingPath, workforceProfilePath } from "@/lib/routes";
import { awaitingReview, reviewTimeText, type ReviewStatus } from "@/lib/validation/partner-review";

type PartnerReviewDashboardProps = {
  lang: string;
  organization: { slug: string; displayName: string };
  status: Exclude<ReviewStatus, "onboarding">;
  targetDays: number;
};

const decided = {
  info_requested: {
    title: "Our team asked for more information",
    text: "Check the step our team named, then submit your company again.",
  },
  listed: { title: "Your company is listed", text: "Employers can find it in the partner directories." },
  declined: { title: "Your company is not listed", text: "Our team decided not to list it in the partner directories." },
} as const;

// The dashboard of a recruitment or staffing company once it has been submitted for review (FR-J1 AC11): the state of
// the review and what to do meanwhile. The recruitment and staffing dashboards replace it (V30); the decisions, their
// reasons and the notices about them come with V11 and V14. Never "approved" or "verified" (decision 2.6).
export function PartnerReviewDashboard({ lang, organization, status, targetDays }: PartnerReviewDashboardProps) {
  const profileLink = (
    <TextLink standalone href={workforceProfilePath(lang, organization.slug)}>
      Complete your workforce profile
    </TextLink>
  );
  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader title="Dashboard" description={organization.displayName} />
      {awaitingReview(status) ? (
        <Card as="section" padding="lg" aria-labelledby="review-heading" className="gap-6">
          <div className="grid gap-2">
            <h2 id="review-heading" className="text-h2">
              Your company is waiting for review
            </h2>
            <p className="text-body text-muted-foreground">
              Our team is reviewing {organization.displayName}. A review usually takes {reviewTimeText(targetDays)}. Until it
              is done, your company is not shown to employers.
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
          <p className="text-body text-muted-foreground">{decided[status].text}</p>
          {status === "info_requested" ? (
            <TextLink standalone href={onboardingPath(lang)}>
              Review and submit again
            </TextLink>
          ) : (
            profileLink
          )}
        </Card>
      )}
    </div>
  );
}
