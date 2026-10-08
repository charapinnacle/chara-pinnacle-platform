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

export function priceLine(plan: Pick<SoldPlan, "priceMinor" | "currency" | "interval">): string {
  return `${formatPrice(plan.priceMinor, plan.currency)} per ${plan.interval}, excluding VAT`;
}

export function daysText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export type Disclosure = { title: string; text: string };

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
          ? `When the trial ends, your subscription converts to the paid ${plan.name} plan and your payment method is charged automatically.`
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
