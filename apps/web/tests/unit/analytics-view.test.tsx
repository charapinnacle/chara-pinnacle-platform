import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import type { AnalyticsViewProps } from "@/components/analytics/analytics-view";
import type { AnalyticsFigure } from "@/lib/analytics/presentation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AnalyticsView } = await import("@/components/analytics/analytics-view");

const total = (metric: AnalyticsFigure["metric"], value: number | null): AnalyticsFigure => ({
  periodStart: "2026-10-18",
  periodEnd: "2026-11-16",
  metric,
  country: null,
  occupation: null,
  value,
});

const base: AnalyticsViewProps = {
  lang: "en",
  organization: { slug: "manila-skills", type: "recruitment_company", role: "owner" },
  level: 3,
  hasFigures: true,
  fewerThan: 5,
  period: "30d",
  totals: [total("profile_views", 30), total("invitations", null), total("responses", 6)],
  byCountry: [
    { code: "AT", label: "Austria", cells: { profile_views: null } },
    { code: "DE", label: "Germany", cells: { profile_views: 18, invitations: 6 } },
  ],
  byOccupation: [],
};

const render = async (over: Partial<AnalyticsViewProps> = {}) => {
  const { prelude } = await prerender(<AnalyticsView {...base} {...over} />);
  return (await new Response(prelude).text()).replace(/<!-- -->|<!--\/?\$-->/g, "");
};

describe("the analytics page (FR-R6 AC8)", () => {
  it("shows the totals of the period, a hidden count as fewer than 5", async () => {
    const html = await render();
    expect(html).toContain("18 October 2026 to 16 November 2026");
    expect(html).toMatch(/>Profile views<\/th>.*>30<\/span>/);
    expect(html).toMatch(/>Invitations received<\/th>.*>fewer than 5<\/span>/);
    expect(html).toMatch(/>Responses sent<\/th>.*>6<\/span>/);
  });

  it("offers the four periods as a labelled group of links, the current one marked", async () => {
    const html = await render({ period: "90d" });
    expect(html).toContain('role="group" aria-labelledby="period-label"');
    expect(html).toContain('id="period-label"');
    for (const [period, label] of [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["12m", "Last 12 months"]]) {
      expect(html).toMatch(new RegExp(`href="/en/org/manila-skills/analytics\\?period=${period}"[^>]*>${label}</a>`));
    }
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/en\/org\/manila-skills\/analytics\?period=90d">Last 90 days<\/a>/);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it("gives Professional the tables by country and occupation and Enterprise the CSV download as well", async () => {
    let html = await render();
    expect(html).toContain(">By country</h2>");
    expect(html).toContain(">By occupation</h2>");
    expect(html).toMatch(/<th scope="row"[^>]*>Austria<\/th>(<td[^>]*>fewer than 5<\/td>){3}/);
    expect(html).toMatch(/<th scope="row"[^>]*>Germany<\/th><td[^>]*>18<\/td><td[^>]*>6<\/td><td[^>]*>fewer than 5<\/td>/);
    expect(html).toContain("Nothing to break down in this period.");
    expect(html).toContain('action="/en/org/manila-skills/analytics/export"');
    expect(html).toContain('name="period" value="30d"');
    expect(html).toContain("Download CSV");

    html = await render({ level: 2 });
    expect(html).toContain(">By country</h2>");
    expect(html).not.toContain("Download CSV");
  });

  it("tells the Partner plan that breakdowns are in Professional, with Compare plans for managers only", async () => {
    let html = await render({ level: 1, byCountry: null, byOccupation: null });
    expect(html).toContain("Breakdowns by country and occupation are included in Professional.");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/billing"[^>]*>Compare plans/);
    expect(html).not.toContain("By country");
    expect(html).not.toContain("Download CSV");

    html = await render({ level: 1, byCountry: null, byOccupation: null, organization: { ...base.organization, role: "member" } });
    expect(html).toContain("Breakdowns by country and occupation are included in Professional.");
    expect(html).not.toContain("Compare plans");
  });

  it("names the metrics from the side of an employer", async () => {
    const html = await render({
      organization: { slug: "acme", type: "employer", role: "member" },
      level: 2,
      totals: [total("invitations", 12), total("responses", 7), total("selections", null)],
    });
    expect(html).toContain(">Invitations sent</th>");
    expect(html).toContain(">Responses received</th>");
    expect(html).toContain(">Partners selected</th>");
    expect(html).not.toContain("Profile views</th>");
    expect(html).not.toContain("No one sees who viewed your profile.");
    expect(html).toContain("A count below 5 reads");
  });

  it("names no viewer anywhere", async () => {
    const html = await render();
    expect(html).toContain("No one sees who viewed your profile.");
    expect(html).not.toMatch(/viewer_|viewed by/i);
  });
});

describe("the states of the analytics page (FR-R6 AC12)", () => {
  it("says there is no activity yet and leads to the profile when there is no figure", async () => {
    let html = await render({ hasFigures: false, totals: [], byCountry: null, byOccupation: null });
    expect(html).toContain("No activity yet");
    expect(html).toContain("Figures appear the day after employers or partners interact with your profile.");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>Update your profile/);
    expect(html).not.toContain("Totals");

    html = await render({ organization: { slug: "acme", type: "employer", role: "owner" }, hasFigures: false, totals: [] });
    expect(html).toMatch(/href="\/en\/org\/acme\/profile"[^>]*>Update your profile/);
  });

  it("says the plan has no analytics, with Compare plans for managers", async () => {
    let html = await render({ level: 0, hasFigures: false, totals: [] });
    expect(html).toContain("Your plan does not include analytics");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/billing"[^>]*>Compare plans/);
    html = await render({ level: 0, hasFigures: false, totals: [], organization: { ...base.organization, role: "member" } });
    expect(html).toContain("An owner or admin of your company can change the plan.");
  });
});
