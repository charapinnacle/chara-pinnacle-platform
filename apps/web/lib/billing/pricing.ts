import { formatPrice } from "@/lib/billing/presentation";
import { billingPath } from "@/lib/routes";

export type PublicPlan = {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  interval: string;
  trialDays: number;
  contactSales: boolean;
  limits: Readonly<Record<string, number | null>>;
  features: readonly string[];
};

// A plan lists only the limits and features this release delivers (FR-H2): a key without a label here is not shown,
// whatever the plan records hold. A feature of a later phase gets its label with the release that delivers it.
const limitLabels = {
  active_jobs: (value) => `${value} active ${value === 1 ? "vacancy" : "vacancies"}`,
  members: (value) => `${value} team ${value === 1 ? "member" : "members"}`,
} as const satisfies Record<string, (value: number) => string>;

const featureLabels = {
  shortlisting: "Shortlisting of applicants",
  csv_export: "CSV export of the applicant list",
} as const satisfies Record<string, string>;

export type PlanCard = {
  code: string;
  name: string;
  contactSales: boolean;
  price: string | null;
  per: string;
  trial: string[];
  limits: string[];
  features: string[];
};

export function planCard(plan: PublicPlan): PlanCard {
  const price = plan.contactSales ? null : formatPrice(plan.priceMinor, plan.currency);
  const per = `per ${plan.interval}`;
  return {
    code: plan.code,
    name: plan.name,
    contactSales: plan.contactSales,
    price,
    per,
    trial:
      price && plan.trialDays > 0
        ? [
            `${plan.trialDays}-day free trial`,
            `Then ${price} ${per} excl. VAT.`,
            `The trial converts automatically to the paid ${plan.name} plan. One free trial is granted per legal entity.`,
          ]
        : [],
    limits: Object.entries(limitLabels).flatMap(([key, label]) => {
      const value = plan.limits[key];
      return typeof value === "number" ? [label(value)] : [];
    }),
    features: Object.entries(featureLabels).flatMap(([key, label]) => (plan.features.includes(key) ? [label] : [])),
  };
}

export type PricingViewer =
  | { kind: "visitor" }
  | { kind: "worker" }
  | { kind: "member" }
  | { kind: "manager"; slug: string }
  | { kind: "setup" };

type Link = { href: string; label: string };

// The link of a card for the person who reads it. Every label holds the plan name, so the links of a page differ.
export function planLink(viewer: PricingViewer, card: PlanCard, lang: string): Link | null {
  if (card.contactSales) return { href: `/${lang}/contact`, label: `Contact sales about ${card.name}` };
  if (viewer.kind === "visitor") return { href: `/${lang}/signup`, label: `Sign up for ${card.name}` };
  if (viewer.kind === "manager") return { href: billingPath(lang, viewer.slug), label: `Choose ${card.name}` };
  return null;
}

export function viewerNote(viewer: PricingViewer, lang: string): { text: string; link?: Link } | null {
  switch (viewer.kind) {
    case "worker":
      return { text: "Plans are for employers. Workers never pay." };
    case "member":
      return { text: "The owner or an admin of your organisation manages its plan." };
    case "setup":
      return {
        text: "Finish setting up your account to choose a plan.",
        link: { href: `/${lang}/onboarding`, label: "Continue setting up" },
      };
    default:
      return null;
  }
}
