import { graceEnd } from "@/lib/dashboard/plan-status";
import { formatShortDate } from "@/lib/i18n/format";

export type SoldPlan = {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  interval: string;
  trialDays: number;
};

export const subscriptionStatusLabels = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Cancelled",
  paused: "Paused",
} as const;

export type SubscriptionStatus = keyof typeof subscriptionStatusLabels;

export function formatPrice(minor: number, currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(minor / 10 ** digits).replace(/\s/g, " ");
}

type PricedPlan = Pick<SoldPlan, "priceMinor" | "currency" | "interval">;

function perInterval(plan: PricedPlan): string {
  return `${formatPrice(plan.priceMinor, plan.currency)} per ${plan.interval}`;
}

export function priceLine(plan: PricedPlan): string {
  return `${perInterval(plan)}, excluding VAT`;
}

export function shortPriceLine(plan: PricedPlan): string {
  return `${perInterval(plan)} excl. VAT`;
}

export function daysText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export type PlanChange = { kind: "upgrade" | "downgrade"; label: string; plan: SoldPlan };

// What the portal can switch the current plan to (Phase 1): the other plans sold online with the same billing interval,
// as an upgrade when they cost more and a downgrade when they cost less; a plan at the same price is no change. A plan
// that is not sold online (Enterprise, the free plan) has none.
export function planChanges(currentCode: string, plans: SoldPlan[]): PlanChange[] {
  const current = plans.find((plan) => plan.code === currentCode);
  if (!current) return [];
  return plans
    .filter((plan) => plan.code !== current.code && plan.interval === current.interval && plan.priceMinor !== current.priceMinor)
    .map((plan): PlanChange => {
      const kind = plan.priceMinor > current.priceMinor ? "upgrade" : "downgrade";
      return { kind, label: `${kind === "upgrade" ? "Upgrade" : "Downgrade"} to ${plan.name}`, plan };
    });
}

type PlanFactsInput = {
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  pastDueSince: string | null;
};

// The dates and the amount that go with the status of a live subscription, as sentences. A subscription that ends
// shows its end and no next invoice; a failed payment shows the grace period and no next invoice.
export function planFacts(subscription: PlanFactsInput, plan: SoldPlan | undefined): string[] {
  const { status, trialEndsAt, currentPeriodEnd, cancelAt, pastDueSince } = subscription;
  const facts: string[] = [];
  if (status === "trialing" && trialEndsAt) facts.push(`Trial ends ${formatShortDate(trialEndsAt)}`);
  if (status === "past_due" && pastDueSince) {
    facts.push(`Payment failed ${formatShortDate(pastDueSince)}`);
    facts.push(`Grace period ends ${formatShortDate(graceEnd(new Date(pastDueSince)).toISOString())}`);
  }
  if (status === "paused") facts.push("Paused: the free plan applies until the subscription is resumed");
  if (cancelAt) {
    facts.push(`Ends ${formatShortDate(cancelAt)}`);
  } else if (status === "trialing" && trialEndsAt && plan) {
    facts.push(`First payment of ${formatPrice(plan.priceMinor, plan.currency)} excl. VAT on ${formatShortDate(trialEndsAt)}`);
  } else if (status === "active" && currentPeriodEnd) {
    facts.push(`Next invoice ${formatShortDate(currentPeriodEnd)}`);
    if (plan) facts.push(shortPriceLine(plan));
  }
  return facts;
}

export const oneTrialRule = "One free trial is granted for each legal entity.";

export function trialConversion(planName: string): string {
  return `When the trial ends, your subscription converts to the paid ${planName} plan and your payment method is charged automatically.`;
}

type Disclosure = { title: string; text: string };

// The five things the person is told before the redirect (FR-G2): the trial period, the price after it, the billing
// frequency, the automatic conversion and how to cancel. trialUsed says that the legal entity already had its trial,
// so that the first payment is due at once and no trial period is shown.
export function checkoutDisclosures(plan: SoldPlan, trialUsed: boolean): Disclosure[] {
  const trialDays = trialUsed ? 0 : plan.trialDays;
  return [
    {
      title: "Trial period",
      text:
        trialDays > 0
          ? `${daysText(trialDays)} free, starting when you confirm your payment details.`
          : "There is no free trial: a free trial has already been used for this company, so the first payment is due at once.",
    },
    { title: trialDays > 0 ? "Price after the trial" : "Price", text: `${priceLine(plan)}.` },
    { title: "Billing frequency", text: `Billed every ${plan.interval}.` },
    {
      title: "Automatic conversion",
      text:
        trialDays > 0
          ? trialConversion(plan.name)
          : `Your subscription starts as the paid ${plan.name} plan and renews automatically every ${plan.interval}.`,
    },
    {
      title: "How to cancel",
      text:
        trialDays > 0
          ? "Open Manage billing on the billing page and cancel before the trial ends, and you are not charged."
          : "Open Manage billing on the billing page to cancel at any time.",
    },
  ];
}
