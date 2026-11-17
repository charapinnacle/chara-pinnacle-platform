import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NetworkStatisticsAnswer } from "@/lib/actions/admin-statistics";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/admin-statistics", () => ({ networkStatisticsAction: vi.fn() }));

const { NetworkStatistics } = await import("@/components/admin/network-statistics");

const defaults = { from: "2026-03-01", to: "2026-04-30", period: "month" } as const;

function render(initial: NetworkStatisticsAnswer): string {
  return renderToStaticMarkup(<NetworkStatistics defaults={defaults} initial={initial} />);
}

const ready: NetworkStatisticsAnswer = {
  ok: true,
  statistics: {
    minCount: 5,
    statesFrom: "2026-03-31",
    counts: [
      { metric: "recruitment_company.listed", periodStart: "2026-03-01", count: 9 },
      { metric: "recruitment_company.listed", periodStart: "2026-04-01", count: 12 },
      { metric: "recruitment_company.pending_review", periodStart: "2026-03-01", count: null },
      { metric: "recruitment_company.pending_review", periodStart: "2026-02-01", count: null },
    ],
    figures: [
      { metric: "review_median_hours", label: null, unit: "hours", rangeFigure: true, value: 9, base: 17 },
      { metric: "listed.staffing_company", label: null, unit: "count", rangeFigure: false, value: 7, base: 7 },
      { metric: "follows_per_company_page", label: null, unit: "ratio", rangeFigure: false, value: null, base: null },
    ],
  },
};

// FR-S2 AC7, AC9: the Partner network section.
describe("the partner network section", () => {
  it("has a labelled form with From, To and Period", () => {
    const html = render(ready);
    expect(html).toContain('<label data-slot="field-label" class');
    expect(html).toMatch(/for="network-from"[^>]*>From</);
    expect(html).toMatch(/for="network-to"[^>]*>To</);
    expect(html).toMatch(/for="network-period"[^>]*>Period</);
    expect(html).toContain('value="2026-03-01"');
  });

  it("shows a table per metric with the periods, hidden values as fewer than the threshold and the change in words", () => {
    const html = render(ready);
    expect(html).toContain('aria-label="Recruitment companies: Listed at the end of the period"');
    expect(html).toContain("March 2026");
    expect(html).toContain("April 2026");
    expect(html).toContain("up from 9");
    expect(html).toContain("fewer than 5");
    expect(html).not.toContain("Every count of this period is below the privacy threshold of 5, so the counts are hidden");
    expect(html).toContain('<th scope="row"');
  });

  it("names the whole periods counted and reads a state before the first snapshot as unknown", () => {
    const html = render(ready);
    expect(html).toContain("Whole periods from 1 February 2026 to 30 April 2026.");
    expect(html).toContain("States recorded from 31 March 2026");
    const row = html.indexOf(">February 2026</th>");
    const february = html.slice(row, html.indexOf("</tr>", row));
    expect(february).toContain("<td class=\"px-3 py-3 align-top\">-</td>");
    expect(february).not.toContain("fewer than");
  });

  it("shows the key figures of the range and of now with what they are based on", () => {
    const html = render(ready);
    expect(html).toContain('aria-label="Key figures from 2026-03-01 to 2026-04-30"');
    expect(html).toContain("Median time from submission to review decision");
    expect(html).toContain("9 hours");
    expect(html).toContain('aria-label="Key figures now"');
    expect(html).toContain("Listed staffing companies");
    expect(html).toContain("Not shown: based on fewer than 5");
  });

  it("says the counts are hidden below the threshold when every count is hidden, not that nothing happened", () => {
    const html = render({ ok: true, statistics: { minCount: 5, statesFrom: null, figures: [], counts: [{ metric: "partner_saves", periodStart: "2026-03-01", count: null }] } });
    expect(html).toContain("Every count of this period is below the privacy threshold of 5, so the counts are hidden");
    expect(html).toContain("fewer than 5");
  });

  it("offers a retry when the first answer failed", () => {
    const html = render({ ok: false });
    expect(html).toContain("The partner network statistics could not be loaded");
    expect(html).toContain(">Try again</button>");
    expect(html).not.toContain("Key figures");
  });
});
