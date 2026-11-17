import { describe, expect, it } from "vitest";
import {
  countedRange,
  countText,
  figureLabel,
  figureText,
  hasNoActivity,
  metricRows,
  networkMetricGroups,
  periodEnd,
  periodLabel,
  shownMetricGroups,
  trendText,
  type NetworkFigure,
} from "@/lib/admin/network-statistics";
import { lastSixMonths, networkStatisticsSchema } from "@/lib/validation/admin";

const figure = (over: Partial<NetworkFigure>): NetworkFigure => ({
  metric: "approval_share",
  label: null,
  unit: "percent",
  rangeFigure: true,
  value: 75,
  base: 8,
  ...over,
});

// The metrics of private.network_count_metrics() in supabase/migrations/20261212100000_network_statistics.sql, in order,
// then the job order metrics of 20270112100100_job_order_network_statistics.sql (listed while release 2b is on) and the
// messaging and Find Workers metrics of 20270214100100_messaging_network_statistics.sql (while their release is on).
const JOB_ORDER_METRICS = ["requirements", "job_orders", "invitations", "responses", "selections", "submissions", "hires"];
const MESSAGING_METRICS = ["conversations", "messages"];
const FIND_WORKERS_METRICS = ["worker_searches", "contact_requests", "contact_requests_accepted"];
const DATABASE_METRICS = [
  ...["recruitment_company", "staffing_company"].flatMap((type) =>
    ["new", "decision_approve", "decision_request_info", "decision_decline", "onboarding", "pending_review", "info_requested",
      "re_review", "listed", "declined", "active", "suspended"].map((key) => `${type}.${key}`),
  ),
  "partner_suspensions", "partner_reinstatements", "partner_profiles_hidden", "partner_profile_reports",
  "appeals_lodged", "appeals_decided", "appeals_restored",
  "searches.recruitment", "searches.staffing", "searches.available_workforce", "partner_saves", "partner_follows",
  ...JOB_ORDER_METRICS,
  ...MESSAGING_METRICS,
  ...FIND_WORKERS_METRICS,
];

// FR-S2 AC7, AC9: the words of the Partner network section.
describe("the partner network statistics", () => {
  it("give words to every metric the database returns, in its order, each once", () => {
    expect(networkMetricGroups.flatMap((group) => group.metrics.map((metric) => metric.key))).toEqual(DATABASE_METRICS);
    const captions = networkMetricGroups.flatMap((group) => group.metrics.map((metric) => `${group.heading}: ${metric.label}`));
    expect(new Set(captions).size).toBe(captions.length);
  });

  it("show only the metrics the database returned, so the job order group appears with release 2b", () => {
    const rows = (metrics: string[]) => metrics.map((metric) => ({ metric, periodStart: "2027-03-01", count: null }));
    const partnerOnly = DATABASE_METRICS.filter(
      (metric) => ![...JOB_ORDER_METRICS, ...MESSAGING_METRICS, ...FIND_WORKERS_METRICS].includes(metric),
    );
    expect(shownMetricGroups(rows(partnerOnly)).map((group) => group.heading)).not.toContain("Job orders");
    const withoutSubmissions = shownMetricGroups(rows([...partnerOnly, ...JOB_ORDER_METRICS.slice(0, 5)]));
    expect(withoutSubmissions.find((group) => group.heading === "Job orders")?.metrics.map((metric) => metric.key)).toEqual(
      JOB_ORDER_METRICS.slice(0, 5),
    );
    expect(shownMetricGroups(rows(DATABASE_METRICS)).flatMap((group) => group.metrics.map((metric) => metric.key))).toEqual(
      DATABASE_METRICS,
    );
  });

  it("show the messaging and Find Workers groups with their releases (2c), each on its own", () => {
    const rows = (metrics: string[]) => metrics.map((metric) => ({ metric, periodStart: "2027-03-01", count: null }));
    const before = DATABASE_METRICS.filter((metric) => ![...MESSAGING_METRICS, ...FIND_WORKERS_METRICS].includes(metric));
    expect(shownMetricGroups(rows(before)).map((group) => group.heading)).not.toContain("Messaging");
    const findWorkersOnly = shownMetricGroups(rows([...before, ...FIND_WORKERS_METRICS])).map((group) => group.heading);
    expect(findWorkersOnly).toContain("Find Workers");
    expect(findWorkersOnly).not.toContain("Messaging");
    expect(
      shownMetricGroups(rows(DATABASE_METRICS))
        .filter((group) => group.heading === "Messaging" || group.heading === "Find Workers")
        .flatMap((group) => group.metrics.map((metric) => `${group.heading}: ${metric.label}`)),
    ).toEqual([
      "Messaging: Conversations started",
      "Messaging: Messages sent",
      "Find Workers: Find Workers searches",
      "Find Workers: Contact requests sent",
      "Find Workers: Contact requests accepted",
    ]);
  });

  it("say the change from the previous period in words only where both values are shown", () => {
    expect(trendText(12, 9)).toBe("up from 9");
    expect(trendText(7, 9)).toBe("down from 9");
    expect(trendText(9, 9)).toBe("no change from 9");
    expect(trendText(null, 9)).toBe("-");
    expect(trendText(9, null)).toBe("-");
    expect(trendText(9, undefined)).toBe("-");
  });

  it("order the rows of a metric by period and compare each with the one before", () => {
    const rows = metricRows(
      [
        { metric: "partner_saves", periodStart: "2026-04-01", count: 12 },
        { metric: "partner_saves", periodStart: "2026-03-01", count: 9 },
        { metric: "partner_follows", periodStart: "2026-03-01", count: 30 },
        { metric: "partner_saves", periodStart: "2026-05-01", count: null },
      ],
      "partner_saves",
      "month",
      "2026-04-15",
    );
    expect(rows).toEqual([
      { periodStart: "2026-03-01", count: 9, unknown: false, trend: "-" },
      { periodStart: "2026-04-01", count: 12, unknown: false, trend: "up from 9" },
      { periodStart: "2026-05-01", count: null, unknown: false, trend: "-" },
    ]);
  });

  it("read a hidden state as unknown only for a period that ended before the first snapshot", () => {
    const counts = [
      { metric: "staffing_company.listed", periodStart: "2026-02-01", count: null },
      { metric: "staffing_company.listed", periodStart: "2026-03-01", count: null },
      { metric: "partner_saves", periodStart: "2026-02-01", count: null },
    ];
    expect(metricRows(counts, "staffing_company.listed", "month", "2026-03-31").map((row) => row.unknown)).toEqual([true, false]);
    expect(metricRows(counts, "staffing_company.listed", "month", null).map((row) => row.unknown)).toEqual([true, true]);
    expect(metricRows(counts, "partner_saves", "month", "2026-03-31").map((row) => row.unknown)).toEqual([false]);
  });

  it("give the last day of each period and the whole range the database counted", () => {
    expect(periodEnd("2026-03-30", "week")).toBe("2026-04-05");
    expect(periodEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(periodEnd("2026-10-01", "quarter")).toBe("2026-12-31");
    expect(periodEnd("2026-01-01", "year")).toBe("2026-12-31");
    expect(countedRange([{ metric: "x", periodStart: "2026-04-01", count: 1 }, { metric: "x", periodStart: "2026-03-01", count: 1 }], "month"))
      .toEqual({ from: "2026-03-01", to: "2026-04-30" });
    expect(countedRange([], "month")).toBeNull();
  });

  it("show a hidden count as fewer than the threshold", () => {
    expect(countText(null, 5)).toBe("fewer than 5");
    expect(countText(null, 8)).toBe("fewer than 8");
    expect(countText(1240, 5)).toBe("1,240");
  });

  it("format the key figures by unit and hide a value with a small base", () => {
    expect(figureText(figure({ value: 88.2 }), 5)).toBe("88.2 %");
    expect(figureText(figure({ unit: "hours", value: 9 }), 5)).toBe("9 hours");
    expect(figureText(figure({ unit: "hours", value: 1 }), 5)).toBe("1 hour");
    expect(figureText(figure({ unit: "ratio", value: 1.25 }), 5)).toBe("1.25");
    expect(figureText(figure({ unit: "count", value: 14 }), 5)).toBe("14");
    expect(figureText(figure({ value: null, base: null }), 5)).toBe("Not shown: based on fewer than 5");
  });

  it("name a plan figure by its partner type and plan, and no figure it does not know", () => {
    expect(figureLabel(figure({ metric: "plan.staffing_company.staffing_professional", label: "Professional", unit: "count" }))).toBe(
      "Staffing companies on the Professional plan",
    );
    expect(figureLabel(figure({ metric: "review_median_hours" }))).toBe("Median time from submission to review decision");
    expect(figureLabel(figure({ metric: "licences_expired" }))).toBe("Expired licences");
    expect(figureLabel(figure({ metric: "requirements_open" }))).toBeNull();
  });

  it("label the periods in UTC", () => {
    expect(periodLabel("2026-03-01", "month")).toBe("March 2026");
    expect(periodLabel("2026-03-02", "week")).toBe("Week of 2 March 2026");
    expect(periodLabel("2026-04-01", "quarter")).toBe("Q2 2026");
    expect(periodLabel("2026-01-01", "year")).toBe("2026");
  });

  it("find no activity only when every count is hidden", () => {
    expect(hasNoActivity([{ metric: "partner_saves", periodStart: "2026-03-01", count: null }])).toBe(true);
    expect(hasNoActivity([{ metric: "partner_saves", periodStart: "2026-03-01", count: 5 }])).toBe(false);
  });
});

describe("the partner network range", () => {
  it("defaults to six calendar months up to today", () => {
    expect(lastSixMonths(new Date("2026-10-27T15:00:00Z"))).toEqual({ from: "2026-05-01", to: "2026-10-27" });
    expect(lastSixMonths(new Date("2026-02-10T00:00:00Z"))).toEqual({ from: "2025-09-01", to: "2026-02-10" });
  });

  it("puts a start after the end on From, refuses 367 days and accepts 366, and knows four periods", () => {
    const after = networkStatisticsSchema.safeParse({ from: "2026-05-01", to: "2026-04-30", period: "month" });
    expect(after.success).toBe(false);
    expect(after.error?.issues).toEqual([expect.objectContaining({ path: ["from"], message: "The start date must not be after the end date" })]);
    expect(networkStatisticsSchema.safeParse({ from: "2025-03-01", to: "2026-03-02", period: "month" }).error?.issues[0].message).toBe(
      "Choose at most 366 days",
    );
    expect(networkStatisticsSchema.safeParse({ from: "2025-03-02", to: "2026-03-02", period: "month" }).success).toBe(true);
    for (const period of ["week", "month", "quarter", "year"]) {
      expect(networkStatisticsSchema.safeParse({ from: "2026-03-01", to: "2026-03-31", period }).success).toBe(true);
    }
    expect(networkStatisticsSchema.safeParse({ from: "2026-03-01", to: "2026-03-31", period: "day" }).error?.issues[0].message).toBe(
      "Choose a period",
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect(networkStatisticsSchema.safeParse({ from: today, to: tomorrow, period: "month" }).error?.issues).toEqual([
      expect.objectContaining({ path: ["to"], message: "The end date must not be after today" }),
    ]);
    expect(networkStatisticsSchema.safeParse({ from: today, to: today, period: "month" }).success).toBe(true);
  });
});
