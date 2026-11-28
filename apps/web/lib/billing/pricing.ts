import * as z from "zod";
import type { OrganizationType } from "@/lib/billing/limits";
import { daysText, formatPrice, oneTrialRule, trialConversion } from "@/lib/billing/presentation";
import type { ReleaseSwitch } from "@/lib/release";
import { billingPath, signUpPath } from "@/lib/routes";

export const publicPlanSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    price_minor: z.number().int(),
    currency: z.string(),
    interval: z.string(),
    trial_days: z.number().int(),
    contact_sales: z.boolean(),
    limits: z.record(z.string(), z.number().int().nullable()),
    features: z.array(z.string()),
  })
  .transform((row) => ({
    code: row.code,
    name: row.name,
    priceMinor: row.price_minor,
    currency: row.currency,
    interval: row.interval,
    trialDays: row.trial_days,
    contactSales: row.contact_sales,
    limits: row.limits,
    features: row.features,
  }));

export type PublicPlan = z.infer<typeof publicPlanSchema>;

// A plan lists only the limits and features with a label here (FR-H2): a key without one is not shown, whatever the plan
// records hold. An employer limit without a value is not listed (FR-H2 AC6); a partner limit without one is listed as
// unlimited (FR-R1 AC3). The response limit is one key for both partner types, named after what each type answers.
const plural = (value: number, one: string, other: string) => `${value} ${value === 1 ? one : other}`;

const limitLabels = {
  active_jobs: (value) => (value === null ? null : plural(value, "active vacancy", "active vacancies")),
  members: (value) => (value === null ? null : plural(value, "team member", "team members")),
  active_requirements: (value) =>
    value === null ? null : plural(value, "active workforce requirement", "active workforce requirements"),
  partner_invitations_per_requirement: (value) =>
    value === null ? null : plural(value, "partner invitation per requirement", "partner invitations per requirement"),
  markets: (value) => (value === null ? "Unlimited countries served" : `${plural(value, "country", "countries")} served`),
  listed_occupations: (value) => (value === null ? "Unlimited occupations" : plural(value, "occupation", "occupations")),
  workforce_listings: (value) => (value === null ? "Unlimited workforce listings" : plural(value, "workforce listing", "workforce listings")),
  job_order_responses_per_month: (value, type) => {
    const [one, other] =
      type === "staffing_company"
        ? ["response to workforce requests", "responses to workforce requests"]
        : ["job order response", "job order responses"];
    return value === null ? `Unlimited ${other} per month` : `${plural(value, one, other)} per month`;
  },
  candidate_submissions_per_month: (value) =>
    value === null ? "Unlimited candidate submissions per month" : `${plural(value, "candidate submission", "candidate submissions")} per month`,
} as const satisfies Record<string, (value: number | null, type: OrganizationType) => string | null>;

// The limits a plan of each organisation type lists, and the billing page counts, in this order: those of the features
// the type has in this release. A recruitment company lists available workforce too (FR-K3, assumed default) and its
// dashboard counts the listings, so its plans show the workforce listings limit as the staffing plans do. A partner plan carries a row for every partner key (DATA_MODEL.md section 8), even for a
// feature of the other partner type or of a later release.
export const PLAN_LIMIT_KEYS = {
  employer: ["active_jobs", "members"],
  recruitment_company: ["markets", "listed_occupations", "workforce_listings", "members"],
  staffing_company: ["markets", "listed_occupations", "workforce_listings", "members"],
} as const satisfies Record<OrganizationType, readonly (keyof typeof limitLabels)[]>;

// What a card on the pricing page lists besides: the workforce requirements and partner invitations of an employer plan,
// and the job order responses and candidate submissions of a partner plan (FR-R1 AC3), read from the plan records like
// the others.
const PRICING_LIMIT_KEYS = {
  employer: [...PLAN_LIMIT_KEYS.employer, "active_requirements", "partner_invitations_per_requirement"],
  recruitment_company: [...PLAN_LIMIT_KEYS.recruitment_company, "job_order_responses_per_month", "candidate_submissions_per_month"],
  staffing_company: [...PLAN_LIMIT_KEYS.staffing_company, "job_order_responses_per_month", "candidate_submissions_per_month"],
} as const satisfies Record<OrganizationType, readonly (keyof typeof limitLabels)[]>;

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[OrganizationType][number];

// A feature of Phase 2 is listed only while the release that delivers it is on (FR-L5 AC7), so a card never names a
// feature nobody can use yet.
const featureLabels = {
  shortlisting: { label: "Shortlisting of applicants", release: null },
  csv_export: { label: "CSV export of the applicant list", release: null },
  advanced_partner_search: { label: "Advanced partner search filters", release: "release_partner_directories" },
  available_workforce_search: { label: "Available workforce search", release: "release_partner_directories" },
  chara_match: { label: "CHARA Match", release: "release_chara_match" },
  job_order_access: { label: "Job order access", release: "release_job_orders" },
  employer_discovery: { label: "Find employers by destination and industry", release: "release_job_orders" },
  advanced_employer_discovery: { label: "Find employers by occupation and size, with saved searches", release: "release_job_orders" },
} as const satisfies Record<string, { label: string; release: ReleaseSwitch | null }>;

// The plan the pricing page marks as recommended (OPEN_QUESTIONS.md P19: the owner has not named one; the default is the
// plan in the middle of the range). A code that is not public marks nothing.
export const RECOMMENDED_PLAN_CODE = "employer_professional";

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

// A contact-sales partner plan shows the price it starts from ("From EUR 199.00", DATA_MODEL.md section 8); the
// employer one shows none (FR-H2 AC5). released names the release switches that are on.
export function planCard(plan: PublicPlan, type: OrganizationType = "employer", released: readonly ReleaseSwitch[] = []): PlanCard {
  const stated = type !== "employer" && plan.priceMinor > 0 ? `From ${formatPrice(plan.priceMinor, plan.currency)}` : null;
  const price = plan.contactSales ? stated : formatPrice(plan.priceMinor, plan.currency);
  const per = `per ${plan.interval}`;
  return {
    code: plan.code,
    name: plan.name,
    contactSales: plan.contactSales,
    price,
    per,
    trial:
      !plan.contactSales && price && plan.trialDays > 0
        ? [`${daysText(plan.trialDays)} free trial`, `Then ${price} ${per} excl. VAT.`, `${trialConversion(plan.name)} ${oneTrialRule}`]
        : [],
    limits: PRICING_LIMIT_KEYS[type].flatMap((key: keyof typeof limitLabels) => {
      const text = key in plan.limits ? limitLabels[key](plan.limits[key] ?? null, type) : null;
      return text ? [text] : [];
    }),
    features: Object.entries(featureLabels).flatMap(([key, { label, release }]) =>
      plan.features.includes(key) && (release === null || released.includes(release)) ? [label] : [],
    ),
  };
}

export type PricingViewer =
  | { kind: "visitor" }
  | { kind: "worker" }
  | { kind: "member"; type: OrganizationType }
  | { kind: "manager"; slug: string; type: OrganizationType }
  | { kind: "setup" }
  | { kind: "unknown" };

export type Link = { href: string; label: string };

// The link of a card for the person who reads it, among the plans of one organisation type. Every label holds the plan
// name, so the links of a tab differ. A visitor signs up as that type; an owner or admin is led to the billing page only
// from the plans of the own organisation's type, which are the only ones its checkout sells (FR-R1 AC4).
export function planLink(viewer: PricingViewer, card: PlanCard, lang: string, type: OrganizationType = "employer"): Link | null {
  if (card.contactSales) return { href: `/${lang}/contact`, label: `Contact sales about ${card.name}` };
  if (viewer.kind === "visitor") {
    return { href: signUpPath(lang, type === "employer" ? "company" : type), label: `Sign up for ${card.name}` };
  }
  if (viewer.kind === "manager" && viewer.type === type) {
    return { href: billingPath(lang, viewer.slug), label: `Choose ${card.name}` };
  }
  return null;
}

// partners says that the plans of the partner types are shown too (release 2a), so the plans are for companies.
export function viewerNote(viewer: PricingViewer, lang: string, partners = false): { text: string; link?: Link } | null {
  switch (viewer.kind) {
    case "worker":
      return { text: `Plans are for ${partners ? "companies" : "employers"}. Workers never pay.` };
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
