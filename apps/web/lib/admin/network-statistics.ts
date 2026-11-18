import { formatDate } from "@/lib/i18n/format";
import type { NetworkStatisticsQuery } from "@/lib/validation/admin";

export type NetworkPeriod = NetworkStatisticsQuery["period"];

export type NetworkCount = { metric: string; periodStart: string; count: number | null };

export type NetworkFigureUnit = "count" | "percent" | "hours" | "ratio" | "date";

export type NetworkFigure = {
  metric: string;
  label: string | null;
  unit: NetworkFigureUnit;
  rangeFigure: boolean;
  value: number | null;
  base: number | null;
};

// statesFrom: the first day of the daily partner states; states of a period that ends before it are unknown, not hidden.
export type NetworkStatistics = { counts: NetworkCount[]; figures: NetworkFigure[]; minCount: number; statesFrom: string | null };

type MetricGroup = { heading: string; metrics: readonly { key: string; label: string }[] };

const partnerTypes = [
  { type: "recruitment_company", heading: "Recruitment companies" },
  { type: "staffing_company", heading: "Staffing companies" },
] as const;

const stateKeys = ["onboarding", "pending_review", "info_requested", "re_review", "listed", "declined", "active", "suspended"];

const typeMetrics = [
  ["new", "New sign-ups"],
  ["decision_approve", "Approved at review"],
  ["decision_request_info", "Asked for more information at review"],
  ["decision_decline", "Declined at review"],
  ["onboarding", "Still signing up at the end of the period"],
  ["pending_review", "Waiting for review at the end of the period"],
  ["info_requested", "Asked for information at the end of the period"],
  ["re_review", "In re-review at the end of the period"],
  ["listed", "Listed at the end of the period"],
  ["declined", "Declined at the end of the period"],
  ["active", "Active at the end of the period"],
  ["suspended", "Suspended at the end of the period"],
] as const;

// The order and the words of the metrics of admin_network_counts (FR-S2, release 2a parts). A metric the database adds
// later (2b, 2c) and this list does not name is not shown until it is given words here.
export const networkMetricGroups: readonly MetricGroup[] = [
  ...partnerTypes.map(({ type, heading }) => ({
    heading,
    metrics: typeMetrics.map(([key, label]) => ({ key: `${type}.${key}`, label })),
  })),
  {
    heading: "Moderation and appeals",
    metrics: [
      { key: "partner_suspensions", label: "Partner suspensions" },
      { key: "partner_reinstatements", label: "Partner reinstatements" },
      { key: "partner_profiles_hidden", label: "Partner profiles hidden" },
      { key: "partner_profile_reports", label: "Reports on partner profiles" },
      { key: "appeals_lodged", label: "Appeals lodged" },
      { key: "appeals_decided", label: "Appeals decided" },
      { key: "appeals_restored", label: "Appeals that restored the content" },
    ],
  },
  {
    heading: "Searches, saves and follows",
    metrics: [
      { key: "searches.recruitment", label: "Recruitment partner searches" },
      { key: "searches.staffing", label: "Staffing partner searches" },
      { key: "searches.available_workforce", label: "Available workforce searches" },
      { key: "partner_saves", label: "Partners saved by employers" },
      { key: "partner_follows", label: "Follows of partners" },
    ],
  },
  {
    heading: "Job orders",
    metrics: [
      { key: "requirements", label: "Requirements published" },
      { key: "job_orders", label: "Requirements published as job orders" },
      { key: "invitations", label: "Invitations sent to partners" },
      { key: "responses", label: "Partner responses" },
      { key: "selections", label: "Partner responses selected" },
      { key: "submissions", label: "Candidates submitted by partners" },
      { key: "hires", label: "Submitted candidates hired" },
    ],
  },
];

// The groups and metrics the database returned: the job order metrics only while their release is on.
export function shownMetricGroups(counts: readonly NetworkCount[]): MetricGroup[] {
  const returned = new Set(counts.map((row) => row.metric));
  return networkMetricGroups.flatMap((group) => {
    const metrics = group.metrics.filter((metric) => returned.has(metric.key));
    return metrics.length > 0 ? [{ ...group, metrics }] : [];
  });
}

const figureLabels: Record<string, string> = {
  review_median_hours: "Median time from submission to review decision",
  review_on_target_share: "Review decisions within the target time",
  approval_share: "Review decisions that approved the partner",
  approved_suspended_90d_share: "Approved partners suspended within 90 days",
  appeal_reversal_share: "Appeal decisions that reversed the decision",
  contacts_per_100_searches: "Saves and follows of partners per 100 partner searches",
  "listed.recruitment_company": "Listed recruitment companies",
  "listed.staffing_company": "Listed staffing companies",
  profile_complete_share: "Listed partners with a complete profile",
  occupation_and_industry_share: "Listed partners with an occupation and an industry",
  occupations_median: "Median occupations per listed partner",
  source_and_served_share: "Listed partners with a source and a served country",
  served_countries_median: "Median served countries per listed partner",
  stale_listings: "Stale availability listings of listed partners",
  stale_listings_share: "Share of availability listings that are stale",
  licences_expiring: "Licences expiring within the reminder period",
  licences_expired: "Expired licences",
  partner_profiles_hidden_now: "Partner profiles hidden now",
  partner_profile_reports_open: "Open reports on partner profiles",
  appeals_open: "Open appeals",
  appeals_overdue: "Open appeals past their target date",
  employers_with_saved_partner_share: "Active employers that saved a partner",
  follows_per_company_page: "Follows per public company page",
};

const planTypeLabels: Record<string, string> = {
  recruitment_company: "Recruitment companies",
  staffing_company: "Staffing companies",
};

// The words of a key figure; a plan row is named by its partner type and plan name. Unknown figures have none.
export function figureLabel(figure: NetworkFigure): string | null {
  if (figure.metric.startsWith("plan.")) {
    const type = planTypeLabels[figure.metric.split(".")[1]];
    return type && figure.label ? `${type} on the ${figure.label} plan` : null;
  }
  return figureLabels[figure.metric] ?? null;
}

const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const ratioFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export function hiddenText(minCount: number): string {
  return `fewer than ${minCount}`;
}

export function countText(count: number | null, minCount: number): string {
  return count === null ? hiddenText(minCount) : numberFormat.format(count);
}

// A hidden figure says why without a count: the database hides a share whose part or rest is below the threshold even when
// its base is not (complementary suppression), so "based on fewer than 5" would be wrong next to a base of 7 elsewhere.
export function figureText(figure: NetworkFigure, minCount: number): string {
  if (figure.value === null) return `Not shown: below the privacy threshold of ${minCount}`;
  switch (figure.unit) {
    case "percent":
      return `${numberFormat.format(figure.value)} %`;
    case "hours":
      return `${numberFormat.format(figure.value)} ${figure.value === 1 ? "hour" : "hours"}`;
    case "ratio":
      return ratioFormat.format(figure.value);
    default:
      return numberFormat.format(figure.value);
  }
}

// The change from the previous period in words, only where both values are shown (FR-S2 AC7).
export function trendText(count: number | null, previous: number | null | undefined): string {
  if (count === null || previous === null || previous === undefined) return "-";
  if (count > previous) return `up from ${numberFormat.format(previous)}`;
  if (count < previous) return `down from ${numberFormat.format(previous)}`;
  return `no change from ${numberFormat.format(previous)}`;
}

function isStateMetric(metric: string): boolean {
  const [type, key] = metric.split(".");
  return partnerTypes.some((partner) => partner.type === type) && stateKeys.includes(key);
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
// A day of the statistics (a UTC date, as the form and the database give it) in the shared date format, as 1 March 2025.
export function dayLabel(day: string): string {
  return formatDate(`${day}T00:00:00Z`);
}

// The base of a shown figure; a hidden figure has none (the database hides its base too).
export function baseText(base: number | null): string {
  return base === null ? "-" : numberFormat.format(base);
}

// The last day of the UTC period that starts on periodStart.
export function periodEnd(periodStart: string, period: NetworkPeriod): string {
  const date = new Date(`${periodStart}T00:00:00Z`);
  if (period === "week") date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + (period === "month" ? 1 : period === "quarter" ? 3 : 12));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// The database widens a range to whole periods; this is the range it counted.
export function countedRange(counts: readonly NetworkCount[], period: NetworkPeriod): { from: string; to: string } | null {
  if (counts.length === 0) return null;
  const starts = counts.map((row) => row.periodStart).sort();
  return { from: starts[0], to: periodEnd(starts[starts.length - 1], period) };
}

export function periodLabel(periodStart: string, period: NetworkPeriod): string {
  const date = new Date(`${periodStart}T00:00:00Z`);
  switch (period) {
    case "week":
      return `Week of ${dayLabel(periodStart)}`;
    case "quarter":
      return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    case "year":
      return String(date.getUTCFullYear());
    default:
      return monthFormat.format(date);
  }
}

// unknown: a state of a period that ended before the first daily state was recorded; it reads "-", not "fewer than".
export type MetricRow = { periodStart: string; count: number | null; unknown: boolean; trend: string };

// The rows of one metric in period order, each with its trend against the period before it.
export function metricRows(
  counts: readonly NetworkCount[],
  metric: string,
  period: NetworkPeriod,
  statesFrom: string | null,
): MetricRow[] {
  const state = isStateMetric(metric);
  const rows = counts.filter((row) => row.metric === metric).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return rows.map((row, index) => ({
    periodStart: row.periodStart,
    count: row.count,
    unknown: state && (statesFrom === null || periodEnd(row.periodStart, period) < statesFrom) && row.count === null,
    trend: index === 0 ? "-" : trendText(row.count, rows[index - 1].count),
  }));
}

// No metric of the range is shown: every count is below the threshold, which hides a zero and a small count alike, so the
// page says the counts are hidden rather than that nothing happened (FR-S2 AC9).
export function hasNoActivity(counts: readonly NetworkCount[]): boolean {
  return counts.every((row) => row.count === null);
}
