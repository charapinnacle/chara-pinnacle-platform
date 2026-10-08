import { DateText } from "@/components/dashboard/date-text";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { DashboardPlan } from "@/lib/dal/dashboard";
import { daysLeft, daysLeftText, graceEnd, trialAlert } from "@/lib/dashboard/plan-status";

type PlanAlertsProps = { plan: DashboardPlan; now: Date; billingHref: string | null };

// What needs attention above the numbers: the end of the trial, a failed payment, a subscription that has ended. The
// link to the billing page is for an owner or an admin only (billingHref).
export function PlanAlerts({ plan, now, billingHref }: PlanAlertsProps) {
  const trial = trialAlert(plan.status, plan.trialEndsAt, now);
  const grace = plan.status === "past_due" && plan.pastDueSince ? graceEnd(plan.pastDueSince) : null;
  return (
    <>
      {trial.alert && plan.trialEndsAt ? (
        <Notice tone="error" role="alert">
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
      {plan.status === "past_due" ? (
        <Notice tone="error" role="alert">
          <div className="grid gap-1">
            <p>
              The payment for your plan failed.
              {grace ? (
                <>
                  {" "}
                  Your plan stays active until <DateText date={grace} /> ({daysLeftText(daysLeft(grace, now))}).
                </>
              ) : null}
            </p>
            {billingHref ? (
              <TextLink href={billingHref} className="justify-self-start">
                Update your payment method
              </TextLink>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {plan.subscriptionEnded ? (
        <Notice tone="info" role="status">
          Your subscription has ended. Your vacancies are paused and applicant changes are disabled.
        </Notice>
      ) : null}
    </>
  );
}
