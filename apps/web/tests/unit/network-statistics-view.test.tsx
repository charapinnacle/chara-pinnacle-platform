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
    counts: [
      { metric: "recruitment_company.listed", periodStart: "2026-03-01", count: 9 },
      { metric: "recruitment_company.listed", periodStart: "2026-04-01", count: 12 },
      { metric: "recruitment_company.pending_review", periodStart: "2026-03-01", count: null },
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
    expect(html).not.toContain("No partner network activity in this period");
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

  it("says there was no activity when every count is hidden", () => {
    const html = render({ ok: true, statistics: { minCount: 5, figures: [], counts: [{ metric: "partner_saves", periodStart: "2026-03-01", count: null }] } });
    expect(html).toContain("No partner network activity in this period");
    expect(html).toContain("fewer than 5");
  });

  it("offers a retry when the first answer failed", () => {
    const html = render({ ok: false });
    expect(html).toContain("The partner network statistics could not be loaded");
    expect(html).toContain(">Try again</button>");
    expect(html).not.toContain("Key figures");
  });
});
