import { describe, expect, it } from "vitest";
import {
  analyticsCsv,
  analyticsFileName,
  breakdownRows,
  hasDimension,
  metricLabel,
  parsePeriod,
  shownMetric,
  type AnalyticsFigure,
} from "@/lib/analytics/presentation";

const figure = (over: Partial<AnalyticsFigure>): AnalyticsFigure => ({
  periodStart: "2026-08-19",
  periodEnd: "2026-11-16",
  metric: "profile_views",
  country: null,
  occupation: null,
  value: 30,
  ...over,
});

describe("the CSV export of analytics (FR-R6 AC9)", () => {
  const countries = new Map([
    ["DE", "Germany"],
    ["AT", "Austria"],
  ]);
  const occupations = new Map([["7212", "=HYPERLINK(\"http://evil.example\")"]]);
  const rows = [
    figure({ metric: "invitations", occupation: "7212", value: null }),
    figure({ country: "AT", value: null }),
    figure({ country: "DE", value: 18 }),
    figure({ metric: "invitations", value: 7 }),
    figure({ metric: "inquiries", country: "DE", value: 6 }),
    figure({ metric: "inquiries", value: 9 }),
    figure({}),
  ];
  const lines = analyticsCsv(rows, { countries, occupations, fewerThan: 5 }).split("\r\n");

  it("has the header of the aggregates and no column about a viewer", () => {
    expect(lines[0]).toBe("period_start,period_end,metric,country,occupation,count");
  });

  it("lists the totals first, then the countries, then the occupations, by metric", () => {
    expect(lines.slice(1, 8)).toEqual([
      "2026-08-19,2026-11-16,profile_views,,,30",
      "2026-08-19,2026-11-16,inquiries,,,9",
      "2026-08-19,2026-11-16,invitations,,,7",
      "2026-08-19,2026-11-16,profile_views,Austria,,fewer than 5",
      "2026-08-19,2026-11-16,profile_views,Germany,,18",
      "2026-08-19,2026-11-16,inquiries,Germany,,6",
      `2026-08-19,2026-11-16,invitations,,"'=HYPERLINK(""http://evil.example"")",fewer than 5`,
    ]);
    expect(lines[8]).toBe("");
  });

  it("reads a suppressed cell as below the threshold in force", () => {
    expect(analyticsCsv([figure({ value: null })], { countries, occupations, fewerThan: 8 })).toContain(",fewer than 8\r\n");
  });

  it("names the file after the organisation and the period", () => {
    expect(analyticsFileName("acme-staffing", "90d")).toBe("analytics-acme-staffing-90d.csv");
  });
});

describe("the presentation of analytics (FR-R6 AC8)", () => {
  it("takes one of the four periods and falls back to 30 days", () => {
    expect(["7d", "30d", "90d", "12m"].map(parsePeriod)).toEqual(["7d", "30d", "90d", "12m"]);
    expect([undefined, "1y", ["7d"]].map(parsePeriod)).toEqual(["30d", "30d", "30d"]);
  });

  it("names each metric from the side of the reader and gives an employer no profile views", () => {
    expect(metricLabel("recruitment_company", "invitations")).toBe("Invitations received");
    expect(metricLabel("employer", "invitations")).toBe("Invitations sent");
    expect(metricLabel("staffing_company", "selections")).toBe("Times selected");
    expect(metricLabel("employer", "responses")).toBe("Responses received");
    expect(metricLabel("staffing_company", "inquiries")).toBe("Inquiries received");
    expect(metricLabel("employer", "inquiries")).toBe("Inquiries sent");
    expect(shownMetric("employer", "inquiries")).toBe(true);
    expect(shownMetric("employer", "profile_views")).toBe(false);
    expect(shownMetric("employer", "hires")).toBe(true);
    expect(shownMetric("staffing_company", "profile_views")).toBe(true);
  });

  it("gives profile views and inquiries, which name no requirement, no column by occupation", () => {
    expect(hasDimension("inquiries", "country")).toBe(true);
    expect(hasDimension("inquiries", "occupation")).toBe(false);
    expect(hasDimension("profile_views", "occupation")).toBe(false);
    expect(hasDimension("invitations", "occupation")).toBe(true);
  });

  it("puts the cells of a breakdown in rows by name, a hidden cell as null", () => {
    const rows = breakdownRows(
      [
        figure({ country: "DE", value: 18 }),
        figure({ country: "AT", value: null }),
        figure({ metric: "invitations", country: "DE", value: 6 }),
        figure({ occupation: "7212", value: 9 }),
        figure({}),
      ],
      "country",
      new Map([
        ["DE", "Germany"],
        ["AT", "Austria"],
      ]),
    );
    expect(rows).toEqual([
      { code: "AT", label: "Austria", cells: { profile_views: null } },
      { code: "DE", label: "Germany", cells: { profile_views: 18, invitations: 6 } },
    ]);
  });
});
