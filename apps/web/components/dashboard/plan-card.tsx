import { DateText } from "@/components/dashboard/date-text";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import type { DashboardPlan } from "@/lib/dal/dashboard";
import { daysLeft, daysLeftText, planStatusLabels } from "@/lib/dashboard/plan-status";

type PlanCardProps = { plan: DashboardPlan; now: Date; billingHref: string | null };

// The plan name is the one in billing.plans. Only an owner or an admin gets the link to the billing page (billingHref);
// a member is told whom to ask. No provider reference reaches this component.
export function PlanCard({ plan, now, billingHref }: PlanCardProps) {
  const free = plan.status === "free";
  return (
    <Card as="section" aria-labelledby="plan-heading" padding="lg" elevated className="content-start">
      <h2 id="plan-heading" className="text-body font-medium text-muted-foreground">
        Plan
      </h2>
      <p className="text-figure">{plan.planName}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{planStatusLabels[plan.status]}</dd>
        {plan.status === "trialing" && plan.trialEndsAt ? (
          <>
            <dt className="text-muted-foreground">Trial ends</dt>
            <dd>
              <DateText date={plan.trialEndsAt} /> ({daysLeftText(daysLeft(plan.trialEndsAt, now))})
            </dd>
          </>
        ) : null}
        {plan.status === "active" && plan.currentPeriodEnd ? (
          <>
            <dt className="text-muted-foreground">Next billing date</dt>
            <dd>
              <DateText date={plan.currentPeriodEnd} />
            </dd>
          </>
        ) : null}
      </dl>
      {billingHref ? (
        <TextLink standalone href={billingHref}>
          {free ? "Choose a plan" : "Manage billing"}
        </TextLink>
      ) : free ? (
        <p className="text-body text-muted-foreground">Contact an owner or admin of your company to choose a plan.</p>
      ) : null}
    </Card>
  );
}
