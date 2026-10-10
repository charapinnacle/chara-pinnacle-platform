import { PastDueAlert } from "@/components/billing/past-due-alert";
import { DateText } from "@/components/dashboard/date-text";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { DashboardPlan } from "@/lib/dal/dashboard";
import { daysLeftText, trialAlert } from "@/lib/dashboard/plan-status";

type PlanAlertsProps = { plan: DashboardPlan; now: Date; slug: string; billingHref: string | null };

// What needs attention above the numbers: the end of the trial, a failed payment, a subscription that has ended. The
// link to the billing page and the failed-payment warning are for an owner or an admin only (billingHref): a member
// sees the status on the plan card.
export function PlanAlerts({ plan, now, slug, billingHref }: PlanAlertsProps) {
  const trial = trialAlert(plan.status, plan.trialEndsAt, now);
  return (
    <>
      {trial.alert && plan.trialEndsAt ? (
        <Notice tone="warning" role="alert">
          <div className="grid gap-1">
            <p>
              Your free trial ends on <DateText date={plan.trialEndsAt} /> ({daysLeftText(trial.daysLeft)}).
            </p>
            {billingHref ? (
              <TextLink href={billingHref} className="justify-self-start">
                Choose a plan to keep your vacancies open
              </TextLink>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {plan.status === "past_due" && plan.pastDueSince && billingHref ? (
        <PastDueAlert slug={slug} pastDueSince={plan.pastDueSince} now={now} />
      ) : null}
      {plan.subscriptionEnded ? (
        <Notice tone="info" role="status">
          Your subscription has ended. Your vacancies are paused and applicant changes are disabled.
        </Notice>
      ) : null}
    </>
  );
}
