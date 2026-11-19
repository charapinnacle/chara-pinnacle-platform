import type { JobOrderReason } from "@/lib/dal/job-orders";
import { formatCount } from "@/lib/i18n/format";
import { billingPath, workforceProfilePath } from "@/lib/routes";

// Decision 3.2: the employer's name, or this label where the database withholds it.
export const COMPANY_NOT_NAMED = "Company not named";

export function employerLabel(name: string | null): string {
  return name ?? COMPANY_NOT_NAMED;
}

// FR-N1 AC8: "Fewer than 5" below the threshold the database applies, otherwise the count.
export function responsesText(count: number | null, fewerThan: number | null): string | null {
  if (fewerThan !== null) return `Fewer than ${formatCount(fewerThan)} responses`;
  if (count !== null) return `${formatCount(count)} ${count === 1 ? "response" : "responses"}`;
  return null;
}

// What a partner that sees only the title is told (FR-N1 AC3, AC11), and the section of its own pages that fixes it: the
// countries it serves, the occupations it lists, or the plan (which owners and admins manage; a member is told only).
export function reasonOf(
  reason: JobOrderReason,
  { lang, slug, country, canManage }: { lang: string; slug: string; country: string; canManage: boolean },
): { text: string; action: { href: string; label: string } | null } {
  const profile = workforceProfilePath(lang, slug);
  switch (reason) {
    case "served_country_missing":
      return {
        text: `Add ${country} to the countries you serve to see this job order.`,
        action: { href: `${profile}#where-you-serve-heading`, label: "Edit the countries you serve" },
      };
    case "occupation_missing":
      return {
        text: "List one of the occupations of this job order in your workforce profile to see it.",
        action: { href: `${profile}#what-you-offer-heading`, label: "Edit the occupations you list" },
      };
    case "plan_required":
      return {
        text: "Job orders are shown in full on a paid partner plan.",
        action: canManage ? { href: billingPath(lang, slug), label: "Choose a plan" } : null,
      };
  }
}

export function jobOrderCountText(count: number, hasMore: boolean): string {
  return `${formatCount(count)} ${count === 1 ? "job order" : "job orders"} shown${hasMore ? ", more on the next page" : ""}`;
}
