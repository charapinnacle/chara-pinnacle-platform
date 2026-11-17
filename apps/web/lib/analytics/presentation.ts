import type { Database } from "@chara-pinnacle/db-types";
import { csvCell } from "@/lib/applicants/csv";
import type { OrganizationType } from "@/lib/billing/limits";

export type AnalyticsMetric = Database["public"]["Enums"]["analytics_metric"];
export type AnalyticsDimension = "total" | "country" | "occupation";

export const analyticsPeriods = ["7d", "30d", "90d", "12m"] as const;
export type AnalyticsPeriod = (typeof analyticsPeriods)[number];

export const periodLabels: Record<AnalyticsPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
};

export function parsePeriod(raw: unknown): AnalyticsPeriod {
  return analyticsPeriods.find((period) => period === raw) ?? "30d";
}

export const analyticsMetrics = [
  "profile_views",
  "inquiries",
  "invitations",
  "responses",
  "selections",
  "submissions",
  "hires",
] as const satisfies readonly AnalyticsMetric[];

type Side = "partner" | "employer";

// Each metric counts the records of both organisations, so its name says which way it went for the reader.
const metricLabels: Record<Side, Record<AnalyticsMetric, string>> = {
  partner: {
    profile_views: "Profile views",
    inquiries: "Inquiries received",
    invitations: "Invitations received",
    responses: "Responses sent",
    selections: "Times selected",
    submissions: "Candidates submitted",
    hires: "Hires",
  },
  employer: {
    profile_views: "Profile views",
    inquiries: "Inquiries sent",
    invitations: "Invitations sent",
    responses: "Responses received",
    selections: "Partners selected",
    submissions: "Candidates received",
    hires: "Hires",
  },
};

export function sideOf(type: OrganizationType): Side {
  return type === "employer" ? "employer" : "partner";
}

export function metricLabel(type: OrganizationType, metric: AnalyticsMetric): string {
  return metricLabels[sideOf(type)][metric];
}

// An employer has no partner profile, so no profile views.
export function shownMetric(type: OrganizationType, metric: AnalyticsMetric): boolean {
  return metric !== "profile_views" || type !== "employer";
}

// Profile views and inquiries name no requirement, so they have no cell by occupation.
export function hasDimension(metric: AnalyticsMetric, dimension: "country" | "occupation"): boolean {
  return dimension === "country" || (metric !== "profile_views" && metric !== "inquiries");
}

// A figure as the database returns it, suppressed when value is null.
export type AnalyticsFigure = {
  periodStart: string;
  periodEnd: string;
  metric: AnalyticsMetric;
  country: string | null;
  occupation: string | null;
  value: number | null;
};

export function fewerThanText(threshold: number): string {
  return `fewer than ${threshold}`;
}

export type BreakdownRow = { code: string; label: string; cells: Partial<Record<AnalyticsMetric, number | null>> };

// The cells of one dimension as rows (a country or an occupation) by metric, sorted by name. A metric without a cell in a
// row had nothing there, which the page shows as below the threshold, like a total of 0.
export function breakdownRows(
  figures: readonly AnalyticsFigure[],
  dimension: "country" | "occupation",
  labels: ReadonlyMap<string, string>,
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const figure of figures) {
    const code = dimension === "country" ? figure.country : figure.occupation;
    if (code === null) continue;
    const row = rows.get(code) ?? { code, label: labels.get(code) ?? code, cells: {} };
    row.cells[figure.metric] = figure.value;
    rows.set(code, row);
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, "en") || a.code.localeCompare(b.code));
}

const CSV_HEADER = ["period_start", "period_end", "metric", "country", "occupation", "count"];

// The export of Enterprise (FR-R6 AC9): aggregates only, the totals first, a hidden count as on the page. The names of
// the countries and occupations are the reference labels, escaped so that no spreadsheet runs one as a formula.
export function analyticsCsv(
  figures: readonly AnalyticsFigure[],
  { countries, occupations, fewerThan }: { countries: ReadonlyMap<string, string>; occupations: ReadonlyMap<string, string>; fewerThan: number },
): string {
  const order = (figure: AnalyticsFigure) => (figure.country === null ? (figure.occupation === null ? 0 : 2) : 1);
  const body = [...figures]
    .sort(
      (a, b) =>
        order(a) - order(b) ||
        analyticsMetrics.indexOf(a.metric) - analyticsMetrics.indexOf(b.metric) ||
        (a.country ?? a.occupation ?? "").localeCompare(b.country ?? b.occupation ?? ""),
    )
    .map((figure) => [
      figure.periodStart,
      figure.periodEnd,
      figure.metric,
      figure.country === null ? "" : (countries.get(figure.country) ?? figure.country),
      figure.occupation === null ? "" : (occupations.get(figure.occupation) ?? figure.occupation),
      figure.value === null ? fewerThanText(fewerThan) : String(figure.value),
    ]);
  return [CSV_HEADER, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function analyticsFileName(slug: string, period: AnalyticsPeriod): string {
  return `analytics-${slug}-${period}.csv`;
}
