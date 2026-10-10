import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { DetailList } from "@/components/layout/detail-list";
import { planFacts, subscriptionStatusLabels, type SoldPlan } from "@/lib/billing/presentation";
import type { Subscription } from "@/lib/dal/billing";

type PlanSummaryProps = { subscription: Subscription | null; plan: SoldPlan | undefined };

// The plan, its state and the dates that go with it. No subscription row means the free plan of the organisation; only
// canceled rows mean a lapsed plan, which keeps read access to past applicants (FR-G4).
export function PlanSummary({ subscription, plan }: PlanSummaryProps) {
  const live = subscription !== null && subscription.status !== "canceled";
  const items = live
    ? [
        { label: "Plan", value: subscription.planName ?? "Plan" },
        { label: "Status", value: subscriptionStatusLabels[subscription.status] },
      ]
    : [
        { label: "Plan", value: subscription ? "No active plan" : "Free plan" },
        ...(subscription ? [] : [{ label: "Status", value: "No subscription" }]),
      ];

  return (
    <Card as="section" aria-labelledby="plan-heading">
      <h2 id="plan-heading" className="text-h2">
        Current plan
      </h2>
      <DetailList items={items} />
      {live ? (
        <ul className="grid gap-1 text-body">
          {planFacts(subscription, plan).map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : subscription ? (
        <>
          <p className="text-body">Free plan with read-only access to past applicants.</p>
          <TextLink standalone href="#plans">
            Choose a plan
          </TextLink>
        </>
      ) : null}
    </Card>
  );
}
