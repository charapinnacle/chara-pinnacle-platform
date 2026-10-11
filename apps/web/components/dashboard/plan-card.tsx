import { DateText } from "@/components/dashboard/date-text";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import type { DashboardPlan } from "@/lib/dal/dashboard";
import { daysLeft, daysLeftText, planStatusLabels, planStatusTones } from "@/lib/dashboard/plan-status";

type PlanCardProps = { plan: DashboardPlan; now: Date; billingHref: string | null };

// The plan on one line: its name and status, the date that matters, and the way to billing. The plan name is the one in
// billing.plans. Only an owner or an admin gets the link to the billing page (billingHref); a member is told whom to ask.
// No provider reference reaches this component.
export function PlanCard({ plan, now, billingHref }: PlanCardProps) {
  const free = plan.status === "free";
  return (
    <Card as="section" aria-labelledby="plan-heading" padding="md" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <h2 id="plan-heading" className="text-small font-medium text-muted-foreground">
        Plan
      </h2>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-h2">{plan.planName}</span>
        <StatusBadge status={planStatusTones[plan.status]}>
          <span className="sr-only">Status: </span>
          {planStatusLabels[plan.status]}
        </StatusBadge>
      </p>
      {plan.status === "trialing" && plan.trialEndsAt ? (
        <p className="text-small text-muted-foreground">
          Trial ends <DateText date={plan.trialEndsAt} /> ({daysLeftText(daysLeft(plan.trialEndsAt, now))})
        </p>
      ) : null}
      {plan.status === "active" && plan.currentPeriodEnd ? (
        <p className="text-small text-muted-foreground">
          Next billing date <DateText date={plan.currentPeriodEnd} />
        </p>
      ) : null}
      {billingHref ? (
        <TextLink standalone="flush" href={billingHref} className="ms-auto text-small">
          {free ? "Choose a plan" : "Manage billing"}
        </TextLink>
      ) : free ? (
        <p className="text-small text-muted-foreground">Contact an owner or admin of your company to choose a plan.</p>
      ) : null}
    </Card>
  );
}
