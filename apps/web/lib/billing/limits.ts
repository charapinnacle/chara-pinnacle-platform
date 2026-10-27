import { GENERIC_FAILURE } from "@/lib/auth-errors";
import type { PublicPlan } from "@/lib/billing/pricing";
import { formatCount, formatDate } from "@/lib/i18n/format";

export type OrganizationType = "employer" | "recruitment_company" | "staffing_company";

export type UsageItem = { used: number; limit: number | null; applies: boolean; resetsAt: string | null };

export type OrgUsage = { planName: string | null; items: Readonly<Record<string, UsageItem>> };

// What the upgrade prompt says about one limit: the usage, the plan and, without a billing link, how the higher plans
// compare.
export type UsagePrompt = {
  limitKey: string;
  used: number;
  limit: number;
  resetsAt: string | null;
  planName: string | null;
  comparison: string | null;
};

type Noun = { one: string; other: string };

// What each limit key counts, in the words of the pages (FR-R1 AC12). A response to a job order and a response to an
// employer's workforce request are both partner responses under one key, named after what the partner type answers.
const nouns: Record<string, Noun> = {
  active_jobs: { one: "open vacancy", other: "open vacancies" },
  members: { one: "team member", other: "team members" },
  markets: { one: "country served", other: "countries served" },
  listed_occupations: { one: "occupation listed", other: "occupations listed" },
  workforce_listings: { one: "workforce listing", other: "workforce listings" },
  candidate_submissions_per_month: { one: "candidate submission this month", other: "candidate submissions this month" },
  messages_per_month: { one: "message this month", other: "messages this month" },
  active_requirements: { one: "open workforce requirement", other: "open workforce requirements" },
};

const responseNouns: Record<OrganizationType, Noun> = {
  employer: { one: "job order response this month", other: "job order responses this month" },
  recruitment_company: { one: "job order response this month", other: "job order responses this month" },
  staffing_company: { one: "response to workforce requests this month", other: "responses to workforce requests this month" },
};

function nounOf(key: string, type: OrganizationType): Noun | undefined {
  return key === "job_order_responses_per_month" ? responseNouns[type] : nouns[key];
}

export function limitNoun(key: string, type: OrganizationType, count = 2): string {
  const noun = nounOf(key, type);
  if (!noun) return "items";
  return count === 1 ? noun.one : noun.other;
}

export const GENERIC_LIMIT_MESSAGE = "Your plan's limit is reached.";

// The message for CHARA_LIMIT_REACHED with the detail the database names; an unknown detail gets the general message, so
// no detail code reaches the page.
export function limitRefusalMessage(detail: string | null | undefined, type: OrganizationType): string {
  const noun = detail ? nounOf(detail, type) : undefined;
  return noun ? `Your plan's limit of ${noun.other} is reached.` : GENERIC_LIMIT_MESSAGE;
}

// A database error as the page may show it: a limit refusal in words, anything else the generic failure, never SQL.
export function limitErrorMessage(error: { message: string; details?: string | null }, type: OrganizationType): string {
  return error.message === "CHARA_LIMIT_REACHED" ? limitRefusalMessage(error.details, type) : GENERIC_FAILURE;
}

// "2 of 3 countries served".
export function usageText(key: string, type: OrganizationType, used: number, limit: number): string {
  return `${formatCount(used)} of ${formatCount(limit)} ${limitNoun(key, type, limit)}`;
}

export function resetText(resetsAt: string): string {
  return `The count starts again on ${formatDate(resetsAt)}.`;
}

// The plans of the organisation's type that allow more than the current limit, in their order: "Professional includes
// 10 countries served; Enterprise has no limit." Null when no plan allows more.
export function planComparison(plans: PublicPlan[], key: string, type: OrganizationType, limit: number): string | null {
  const higher = plans.filter((plan) => key in plan.limits && (plan.limits[key] === null || (plan.limits[key] ?? 0) > limit));
  if (higher.length === 0) return null;
  const parts = higher.map(({ name, limits }) => {
    const value = limits[key] ?? null;
    return value === null ? `${name} has no limit` : `${name} includes ${formatCount(value)} ${limitNoun(key, type, value)}`;
  });
  return `${parts.join("; ")}.`;
}

// The limit the database refuses at, or null when it does not apply (not enforced, or the plan has none).
export function appliedLimit(usage: OrgUsage, key: string): number | null {
  const item = usage.items[key];
  return item?.applies ? item.limit : null;
}

// The prompt for a limit that applies, null when it does not. The plans of the organisation's type are compared when
// they are given, next to the link to the billing page.
export function limitPrompt(
  usage: OrgUsage,
  key: string,
  type: OrganizationType,
  plans: PublicPlan[] | null,
): UsagePrompt | null {
  const limit = appliedLimit(usage, key);
  const item = usage.items[key];
  if (limit === null || !item) return null;
  return {
    limitKey: key,
    used: item.used,
    limit,
    resetsAt: item.resetsAt,
    planName: usage.planName,
    comparison: plans ? planComparison(plans, key, type, limit) : null,
  };
}

// The first public plan of the type, in the order of billing.plans, that has the feature: "Professional" for further
// destination countries. Null when no public plan has it.
export function featurePlanName(plans: readonly PublicPlan[], feature: string): string | null {
  return plans.find((plan) => plan.features.includes(feature))?.name ?? null;
}
