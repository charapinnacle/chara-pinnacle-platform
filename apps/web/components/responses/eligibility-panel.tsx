import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { ResponseStatusBadge } from "@/components/responses/response-status";
import type { OrganizationType, UsagePrompt } from "@/lib/billing/limits";
import { jobOrderReasons, type JobOrderReason } from "@/lib/dal/job-orders";
import type { ResponseEligibility } from "@/lib/dal/responses";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { reasonOf } from "@/lib/job-orders/presentation";
import { workersOfferedText } from "@/lib/responses/presentation";
import { billingPath, responsePath, workforceProfilePath } from "@/lib/routes";

export const ELIGIBILITY_HEADING = "Your eligibility to respond";

type EligibilityPanelProps = {
  lang: string;
  slug: string;
  // canManage: an owner or admin (plan, licences); owner: the one who accepts the commitment.
  organization: { id: string; type: OrganizationType; canManage: boolean; owner: boolean };
  eligibility: ResponseEligibility;
  countryName: (code: string) => string;
  // The requirement's main destination by name, for a served country the partner misses.
  destinationName: string;
  // The response form of this requirement: from the job order page or from the invitation page.
  respondHref: string;
  // The upgrade prompt of the monthly limit, read by the page when that is the refusal.
  limitPrompt: UsagePrompt | null;
};

function isJobOrderReason(detail: string | null): detail is JobOrderReason {
  return jobOrderReasons.some((reason) => reason === detail);
}

// Whether the partner can respond now, and the missing condition by name when it cannot (FR-N2 step Check, AC1, AC4;
// FR-J2 AC10): the month's use and Respond; the monthly limit with the upgrade prompt (V13); the employer-pays commitment
// with the way to accept it; the plan; the licence a destination needs; a served country or occupation; a job order that
// is not open. Once the partner responded, its response and status instead (one response per job order).
export function EligibilityPanel(props: EligibilityPanelProps) {
  const { eligibility } = props;
  const { used, limit, applies } = eligibility;
  const counted = applies && limit !== null;
  return (
    <section aria-labelledby="eligibility-heading" className="grid gap-3 rounded-xl border bg-card p-card">
      <h2 id="eligibility-heading" className="text-h2">
        {ELIGIBILITY_HEADING}
      </h2>
      <PanelBody {...props} usage={counted ? `${formatCount(used)} of ${formatCount(limit)} responses used this month` : null} />
    </section>
  );
}

function PanelBody({
  lang,
  slug,
  organization,
  eligibility,
  countryName,
  destinationName,
  respondHref,
  limitPrompt,
  usage,
}: EligibilityPanelProps & { usage: string | null }) {
  const { refusal, detail, responseId, responseStatus } = eligibility;
  if (responseId && responseStatus) {
    return (
      <>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
          Your company responded to this job order. <ResponseStatusBadge status={responseStatus} view="partner" />
        </p>
        <p>
          <TextLink standalone href={responsePath(lang, slug, responseId)}>
            See your response
          </TextLink>
        </p>
      </>
    );
  }
  if (eligibility.canRespond) {
    return (
      <>
        <p className="text-body font-medium">{usage ? `You can respond: ${usage}` : "You can respond to this job order."}</p>
        {eligibility.maxCapacity !== null ? (
          <p className="text-small text-muted-foreground">You can offer up to {workersOfferedText(eligibility.maxCapacity)}.</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <LinkButton href={respondHref} size="default">
            Respond
          </LinkButton>
        </div>
      </>
    );
  }
  switch (refusal) {
    case "CHARA_LIMIT_REACHED":
      return (
        <Notice tone="warning" role="status">
          <p className="font-medium">
            You have used {formatCount(eligibility.used)} of {formatCount(eligibility.limit ?? eligibility.used)} responses this month.
          </p>
          {limitPrompt ? (
            <UpgradePrompt
              organizationId={organization.id}
              organizationType={organization.type}
              prompt={limitPrompt}
              billingHref={billingPath(lang, slug)}
              canUpgrade={organization.canManage}
            />
          ) : eligibility.resetsAt ? (
            <p>The count starts again on {formatDate(eligibility.resetsAt)}.</p>
          ) : null}
        </Notice>
      );
    // Only the owner accepts the commitment (FR-J3), on the workforce profile of this company, whose notice leads to the
    // acceptance (the pattern of that page); everyone else is told who acts.
    case "CHARA_CONSENT_REQUIRED":
      return (
        <Notice tone="warning" role="status">
          {organization.owner ? (
            <>
              <p className="font-medium">Accept the current employer-pays commitment to respond.</p>
              <p className="mt-1">
                <TextLink href={workforceProfilePath(lang, slug)}>Review the commitment</TextLink>
              </p>
            </>
          ) : (
            <p className="font-medium">Your owner needs to accept the employer-pays commitment before you can respond to job orders.</p>
          )}
        </Notice>
      );
    case "CHARA_FEATURE_NOT_IN_PLAN":
      return (
        <Notice tone="warning" role="status">
          <p className="font-medium">Responding to job orders needs a paid partner plan.</p>
          {organization.canManage ? (
            <p className="mt-1">
              <TextLink href={billingPath(lang, slug)}>Choose a plan</TextLink>
            </p>
          ) : (
            <p className="mt-1">Your company&apos;s owners and admins choose the plan.</p>
          )}
        </Notice>
      );
    case "CHARA_LICENCE_REQUIRED":
      return (
        <Notice tone="warning" role="status">
          <p className="font-medium">A licence for {countryName(detail ?? "")} is required to respond to this job order.</p>
          {organization.canManage ? (
            <p className="mt-1">
              <TextLink href={`${workforceProfilePath(lang, slug)}#licences-heading`}>Add a licence</TextLink>
            </p>
          ) : (
            <p className="mt-1">Your company&apos;s owners and admins add licences in the workforce profile.</p>
          )}
        </Notice>
      );
    case "CHARA_FORBIDDEN":
      if (isJobOrderReason(detail)) {
        const { text, action } = reasonOf(detail, { lang, slug, country: destinationName, canManage: organization.canManage });
        return (
          <Notice tone="warning" role="status">
            <p className="font-medium">{text}</p>
            {action ? (
              <p className="mt-1">
                <TextLink href={action.href}>{action.label}</TextLink>
              </p>
            ) : null}
          </Notice>
        );
      }
      return (
        <Notice tone="info" role="status">
          Your company cannot respond to this job order at the moment.
        </Notice>
      );
    case "CHARA_INVALID_STATE":
      return (
        <Notice tone="info" role="status">
          This job order is not open to responses at the moment.
        </Notice>
      );
    default:
      return (
        <Notice tone="info" role="status">
          Your company cannot respond to this job order at the moment.
        </Notice>
      );
  }
}
