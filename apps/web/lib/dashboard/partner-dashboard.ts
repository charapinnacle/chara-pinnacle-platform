import { limitNoun, usageText, type OrgUsage } from "@/lib/billing/limits";
import { classifyUsage } from "@/lib/billing/usage";
import { formatCount } from "@/lib/i18n/format";
import { partnerSubmissionLabels, type SubmissionStatus } from "@/lib/submissions/presentation";
import { partnerSegments, segmentOf, type CompanySegment } from "@/lib/dashboard/segments";
import type { PartnerType } from "@/lib/validation/sign-up";
import type { ReviewStatus } from "@/lib/validation/partner-review";

type OrganizationType = "employer" | PartnerType;

type Membership = { slug: string; type: OrganizationType };

// Which organisation a company user's dashboard shows and under which segment (FR-R3 AC2, FR-R4 AC2): the one named by
// ?org=<slug> among the user's memberships, else the first of the user (the employer segment) or the first of the
// segment's type. A dashboard of the wrong type redirects to the segment of the organisation's type; an unknown slug on a
// partner segment goes back to the user's own dashboard, while the employer segment keeps its answer for outsiders (a
// page that does not exist). Organisations are in membership order.
export type DashboardTarget<T extends Membership> =
  | { kind: "employer" }
  | { kind: "redirect"; segment: CompanySegment; slug?: string }
  | { kind: "partner"; organization: T & { type: PartnerType } };

export function dashboardTarget<T extends Membership>(
  segment: CompanySegment,
  slug: string | undefined,
  organizations: readonly T[],
): DashboardTarget<T> {
  let target: T | undefined;
  if (slug !== undefined) {
    target = organizations.find((organization) => organization.slug === slug);
    if (!target) return segment === "employer" ? { kind: "employer" } : { kind: "redirect", segment: "employer" };
  } else if (segment === "employer") {
    target = organizations[0];
  } else {
    target = organizations.find((organization) => organization.type !== "employer" && partnerSegments[organization.type] === segment);
    if (!target) return { kind: "redirect", segment: "employer" };
  }
  if (!target) return { kind: "employer" };
  const own = segmentOf(target.type);
  if (own !== segment) return { kind: "redirect", segment: own, slug: target.slug };
  const { type } = target;
  return type === "employer" ? { kind: "employer" } : { kind: "partner", organization: { ...target, type } };
}

// The question each dashboard answers (spec §30).
export const dashboardQuestions = {
  recruitment_company: "Which employers need workers I can recruit?",
  staffing_company: "Which employers need the workforce I can provide?",
} as const satisfies Record<PartnerType, string>;

// The figures of get_partner_dashboard.
export type PartnerFigures = {
  reviewStatus: ReviewStatus;
  listed: boolean;
  profileHidden: boolean;
  profileMissing: string | null;
  profileUpdatedAt: string | null;
  listingsTotal: number;
  listingsDue: number;
  listingsStale: number;
  licencesCurrent: number;
  licencesExpiring: number;
  licencesExpired: number;
  nextLicenceExpiry: string | null;
  profileViews: number | null;
  // The threshold below which the count is hidden, set only when it is hidden.
  profileViewsFewerThan: number | null;
  profileViewsInPlan: boolean;
  // The figures of release 2b, null while job orders are off (FR-R3 AC6).
  network: NetworkFigures | null;
  // One count per submission status, null while candidate submissions are off.
  submissionStages: Record<SubmissionStatus, number> | null;
};

export type NetworkFigures = {
  // Fitting job orders (recruitment) or workforce requests (staffing): the fitting marketplace job orders and the
  // requirements the company was invited to and may still answer (FR-R3 AC4, FR-R4 AC3).
  fittingJobOrders: number;
  matchingEmployers: number;
  invitationsAwaiting: number;
  responsesOpen: number;
  responsesShortlisted: number;
  responsesSelected: number;
  responsesDeclined: number;
};

// The outcomes of the approved submissions for one requirement (FR-O5 AC10).
export type SubmissionOutcome = {
  requirementId: string;
  title: string;
  submitted: number;
  inProgress: number;
  hired: number;
  notSelected: number;
  withdrawn: number;
  lastChangeAt: string;
};

// What is still missing from the workforce profile, as the name of what to add (private.partner_profile_missing).
export const missingPartLabels: Readonly<Record<string, string>> = {
  legal_entity_identifier: "your company registration number or other identifier",
  sources_from: "the countries you source workers from",
  serves_market: "the countries you serve",
  occupations: "the occupations you recruit or supply",
  recruitment_type: "your recruitment type",
  staffing_types: "your staffing types",
  employer_pays_commitment: "the employer-pays commitment",
};

export type NextActionTarget = "profile" | "availability" | "licences" | "onboarding" | "company" | "commitment";

export type NextAction = { id: string; text: string; target: NextActionTarget };

const plural = (count: number, one: string, other: string) => `${formatCount(count)} ${count === 1 ? one : other}`;

function missingTarget(part: string): NextActionTarget {
  if (part === "legal_entity_identifier") return "company";
  // The commitment is accepted in the dashboard's own dialog (V52): onboarding sends a submitted company back here.
  if (part === "employer_pays_commitment") return "commitment";
  return "profile";
}

// What the owner or an admin should do next, most urgent first (SOP P2-37 purpose, NFR-U4); empty when nothing waits.
// Every action is one a member cannot take (the profile, listings, licences and the review are changed by the owner or
// an admin), so a member is shown none.
export function nextActions(figures: PartnerFigures, canManage: boolean): NextAction[] {
  if (!canManage) return [];
  const actions: NextAction[] = [];
  if (figures.reviewStatus === "info_requested") {
    actions.push({ id: "review", text: "Answer the request of our team and submit your company again", target: "onboarding" });
  }
  if (figures.profileMissing) {
    const part = missingPartLabels[figures.profileMissing] ?? "the missing details";
    actions.push({ id: "profile", text: `Add ${part} to complete your workforce profile`, target: missingTarget(figures.profileMissing) });
  }
  if (figures.listingsStale > 0) {
    actions.push({
      id: "stale",
      text: `Confirm ${plural(figures.listingsStale, "listing", "listings")} hidden from search`,
      target: "availability",
    });
  }
  if (figures.listingsDue > 0) {
    actions.push({
      id: "due",
      text: `Confirm ${plural(figures.listingsDue, "listing", "listings")} due for confirmation`,
      target: "availability",
    });
  }
  if (figures.listingsTotal === 0) {
    actions.push({ id: "listings", text: "Add the workers you can supply, by country and occupation", target: "availability" });
  }
  if (figures.licencesExpired > 0) {
    actions.push({
      id: "expired",
      text: `Renew ${plural(figures.licencesExpired, "expired licence", "expired licences")}`,
      target: "licences",
    });
  }
  if (figures.licencesExpiring > 0) {
    actions.push({
      id: "expiring",
      text: `Update ${plural(figures.licencesExpiring, "licence that expires", "licences that expire")} soon`,
      target: "licences",
    });
  }
  if (figures.licencesCurrent + figures.licencesExpired === 0) {
    actions.push({ id: "licences", text: "Add the licence you hold for each country where you work", target: "licences" });
  }
  return actions;
}

// The limit keys shown in the plan block: those of release 2a, and the monthly responses and submissions while their
// features are released (FR-R3 AC9, FR-R4 AC8).
export function planUsageKeys(released: { jobOrders: boolean; submissions: boolean }): string[] {
  return [
    "markets",
    "listed_occupations",
    "workforce_listings",
    "members",
    ...(released.jobOrders ? ["job_order_responses_per_month"] : []),
    ...(released.submissions ? ["candidate_submissions_per_month"] : []),
  ];
}

// "7 of 10 workforce listings", or "7 workforce listings (no limit)" when the plan has none (FR-R4 AC8): the limit of the
// plan, as the billing page shows it, whether or not the limits are enforced yet.
export function usageLine(usage: OrgUsage, key: string, type: PartnerType): string | null {
  const item = usage.items[key];
  if (!item) return null;
  return item.limit === null
    ? `${formatCount(item.used)} ${limitNoun(key, type, item.used)} (no limit)`
    : usageText(key, type, item.used, item.limit);
}

// Whether a usage line needs the plan's attention: a limit of 0 already reached by the owner alone ("1 of 0 team
// members" on a free plan, where team_size counts the owner, FR-R1 AC2 and AC8) or listings kept after a lapse are over
// the limit, and the card says so with the way to upgrade instead of leaving the figure alone. Null when within it.
export function usageAttention(usage: OrgUsage, key: string): "at_limit" | "over_limit" | null {
  const item = usage.items[key];
  if (!item) return null;
  const { state } = classifyUsage(item.used, item.limit);
  return state === "at_limit" || state === "over_limit" ? state : null;
}

// The 30-day view count as the page says it (FR-R3 AC10): a hidden small count is "fewer than 5", never the number.
export function profileViewsText(figures: Pick<PartnerFigures, "profileViews" | "profileViewsFewerThan">): string {
  if (figures.profileViewsFewerThan !== null) return `fewer than ${formatCount(figures.profileViewsFewerThan)}`;
  return formatCount(figures.profileViews ?? 0);
}

// The statuses as the dashboard counts them, in the order a submission moves; a request the candidate has not answered
// is waiting for the worker's agreement (FR-R3 AC5).
const stageOrder: readonly SubmissionStatus[] = [
  "awaiting_candidate",
  "submitted",
  "viewed",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
  "declined_by_candidate",
  "expired",
];

const stageLabels: Record<SubmissionStatus, string> = {
  ...partnerSubmissionLabels,
  awaiting_candidate: "Waiting for the worker's agreement",
};

// The statuses that hold a submission, with their labels; none when the company has submitted no one.
export function submissionStageLines(stages: Record<SubmissionStatus, number>): { status: SubmissionStatus; label: string; count: number }[] {
  return stageOrder.filter((status) => stages[status] > 0).map((status) => ({ status, label: stageLabels[status], count: stages[status] }));
}

// "8 submitted: 1 hired, 1 not selected, 5 in progress", the parts at 0 left out.
export function outcomeText(outcome: SubmissionOutcome): string {
  const parts = [
    outcome.hired > 0 ? `${formatCount(outcome.hired)} hired` : null,
    outcome.notSelected > 0 ? `${formatCount(outcome.notSelected)} not selected` : null,
    outcome.inProgress > 0 ? `${formatCount(outcome.inProgress)} in progress` : null,
    outcome.withdrawn > 0 ? `${formatCount(outcome.withdrawn)} withdrawn` : null,
  ].filter((part) => part !== null);
  const head = `${formatCount(outcome.submitted)} submitted`;
  return parts.length > 0 ? `${head}: ${parts.join(", ")}` : head;
}
