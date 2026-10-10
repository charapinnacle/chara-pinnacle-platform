import { CreditCard } from "lucide-react";
import { DateText } from "@/components/dashboard/date-text";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card, CardFooter, CardHeader } from "@/components/layout/card";
import type { DashboardPlan } from "@/lib/dal/dashboard";
import { daysLeft, daysLeftText, planStatusLabels, planStatusTones } from "@/lib/dashboard/plan-status";

type PlanCardProps = { plan: DashboardPlan; now: Date; billingHref: string | null };

// The plan name is the one in billing.plans. Only an owner or an admin gets the link to the billing page (billingHref);
// a member is told whom to ask. No provider reference reaches this component.
export function PlanCard({ plan, now, billingHref }: PlanCardProps) {
  const free = plan.status === "free";
  return (
    <Card as="section" aria-labelledby="plan-heading" padding="lg" elevated className="h-full content-start gap-4">
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="plan-heading" className="text-small font-medium text-foreground">
            Plan
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-figure">{plan.planName}</span>
            <StatusBadge status={planStatusTones[plan.status]}>
              <span className="sr-only">Status: </span>
              {planStatusLabels[plan.status]}
            </StatusBadge>
          </p>
        </div>
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-ink">
          <CreditCard className="size-4" strokeWidth={1.75} />
        </span>
      </CardHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small empty:hidden">
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
        <CardFooter>
          <TextLink standalone="flush" href={billingHref} className="text-small">
            {free ? "Choose a plan" : "Manage billing"}
          </TextLink>
        </CardFooter>
      ) : free ? (
        <p className="text-small text-muted-foreground">Contact an owner or admin of your company to choose a plan.</p>
      ) : null}
    </Card>
  );
}
