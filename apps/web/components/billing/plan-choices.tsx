import { TextLink } from "@/components/forms/text-link";
import { Notice } from "@/components/forms/notice";
import { Card, CardFooter, CardHeader } from "@/components/layout/card";
import { daysText, shortPriceLine, type SoldPlan } from "@/lib/billing/presentation";

type PlanChoicesProps = { plans: SoldPlan[]; checkoutHref: (planCode: string) => string; offerTrial: boolean };

// The plans sold online, each leading to the confirmation step where the final trial eligibility is decided (FR-G2).
export function PlanChoices({ plans, checkoutHref, offerTrial }: PlanChoicesProps) {
  return (
    <section id="plans" aria-labelledby="plans-heading" className="grid gap-3">
      <h2 id="plans-heading" className="text-h2">
        Choose a plan
      </h2>
      <Notice tone="info" role="status">
        You have no active subscription, and no payment was taken.
      </Notice>
      <ul className="grid gap-3">
        {plans.map((plan) => {
          const trial = offerTrial && plan.trialDays > 0;
          const label = trial ? `Start ${plan.trialDays}-day free trial` : "Subscribe";
          return (
            <Card as="li" key={plan.code} className="gap-1">
              <CardHeader>
                <h3 className="font-medium">{plan.name}</h3>
                <p className="text-small text-muted-foreground">{shortPriceLine(plan)}</p>
                <p className="text-small text-muted-foreground">
                  {trial ? `${daysText(plan.trialDays)} free trial` : "No free trial"}
                </p>
              </CardHeader>
              <CardFooter>
                <TextLink
                  standalone
                  href={checkoutHref(plan.code)}
                  aria-label={trial ? `${label} of ${plan.name}` : `${label} to ${plan.name}`}
                >
                  {label}
                </TextLink>
              </CardFooter>
            </Card>
          );
        })}
      </ul>
    </section>
  );
}
