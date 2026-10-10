import { renderToStaticMarkup } from "react-dom/server";
import { Briefcase } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { PlanAlerts } from "@/components/dashboard/plan-alerts";
import { PlanCard } from "@/components/dashboard/plan-card";
import { StageBar } from "@/components/dashboard/stage-bar";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import type { DashboardPlan } from "@/lib/dal/dashboard";

vi.mock("server-only", () => ({}));

const now = new Date("2026-10-08T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const billing = "/en/org/acme/billing";
const plan = (over: Partial<DashboardPlan>): DashboardPlan => ({
  planName: "Basic",
  status: "active",
  trialEndsAt: null,
  currentPeriodEnd: null,
  pastDueSince: null,
  subscriptionEnded: false,
  ...over,
});
const alerts = (over: Partial<DashboardPlan>, billingHref: string | null = billing) =>
  renderToStaticMarkup(<PlanAlerts plan={plan(over)} now={now} slug="acme" billingHref={billingHref} />);
const card = (over: Partial<DashboardPlan>, billingHref: string | null = billing) =>
  renderToStaticMarkup(<PlanCard plan={plan(over)} now={now} billingHref={billingHref} />);
const trial = (ms: number) => ({ status: "trialing" as const, trialEndsAt: new Date(now.getTime() + ms) });

describe("the trial on the plan card and in the alert (FR-E5 AC5)", () => {
  it("shows the plan name, Trial, the end date and 11 days left, and no alert, 10 days 5 hours before the end", () => {
    const html = card(trial(10 * DAY + 5 * HOUR));
    expect(html).toContain("Basic");
    expect(html).toContain("Trial");
    expect(html).toContain("18 October 2026");
    expect(html).toContain("11 days left");
    expect(alerts(trial(10 * DAY + 5 * HOUR))).toBe("");
  });

  it("raises an alert with the end date and 2 days left, and a billing link for an owner or an admin only", () => {
    const owner = alerts(trial(2 * DAY));
    expect(owner).toContain('role="alert"');
    expect(owner).toContain("10 October 2026");
    expect(owner).toContain("2 days left");
    expect(owner).toContain(`href="${billing}"`);
    const member = alerts(trial(2 * DAY), null);
    expect(member).toContain('role="alert"');
    expect(member).toContain("2 days left");
    expect(member).not.toContain("href=");
  });
});

describe("an active plan and a failed payment (FR-E5 AC5, AC7)", () => {
  it("shows the plan name, Active and the next billing date, with no reference", () => {
    const html = card({ planName: "Professional", currentPeriodEnd: new Date("2026-11-03T00:00:00Z") });
    expect(html).toContain("Professional");
    expect(html).toContain("Active");
    expect(html).toContain("Next billing date");
    expect(html).toContain("3 November 2026");
    expect(html).not.toMatch(/stripe|provider|cus_|sub_/i);
    expect(alerts({ currentPeriodEnd: new Date("2026-11-03T00:00:00Z") })).toBe("");
  });

  it("warns an owner or an admin above the cards that the payment failed, with the day it failed, the end of the grace period and the button of the portal", () => {
    const past = { status: "past_due" as const, pastDueSince: new Date(now.getTime() - 2 * DAY) };
    const owner = alerts(past);
    expect(owner).toContain('role="alert"');
    expect(owner.replace(/<[^>]+>/g, "")).toContain(
      "Payment failed on 6 Oct 2026. Update your payment method before 13 Oct 2026 to keep your plan.",
    );
    expect(owner).toContain(">Update payment method</button>");
    const html = card(past);
    expect(html).toContain("Past due");
    expect(html).toContain("Basic");
  });

  it("shows a member no payment warning, only the status on the plan card", () => {
    const past = { status: "past_due" as const, pastDueSince: new Date(now.getTime() - 2 * DAY) };
    expect(alerts(past, null)).toBe("");
    expect(card(past, null)).toContain("Past due");
  });

  it("says the grace period has ended instead of a date in the past once 7 days have passed", () => {
    const owner = alerts({ status: "past_due", pastDueSince: new Date(now.getTime() - 8 * DAY) }).replace(/<[^>]+>/g, "");
    expect(owner).toMatch(/Payment failed on 30 Sept? 2026\. The grace period has ended\. Update your payment method now\./);
    expect(owner).not.toContain("to keep your plan");
  });
});

describe("an organization without a paid plan (FR-E5 AC8)", () => {
  const free = { planName: "Free", status: "free" as const };

  it("shows the Free plan and no trial date, and a banner only when a subscription has ended", () => {
    const html = card(free);
    expect(html).toContain("Free");
    expect(html).toContain("Free plan");
    expect(html).not.toContain("Trial ends");
    expect(alerts(free)).toBe("");
    const ended = alerts({ ...free, subscriptionEnded: true });
    expect(ended).toContain("Your subscription has ended");
    expect(ended).toContain("vacancies are paused");
    expect(ended).toContain("applicant changes are disabled");
  });

  it("offers Choose a plan to an owner or an admin and tells a member whom to ask, with no billing link", () => {
    expect(card(free)).toContain(`href="${billing}"`);
    expect(card(free)).toContain("Choose a plan");
    const member = card(free, null);
    expect(member).toContain("Contact an owner or admin");
    expect(member).not.toContain("href=");
  });
});

describe("the cards and the table of stages (FR-E5 AC1 to AC3, AC11)", () => {
  it("makes the whole card a link whose name carries the number", () => {
    const html = renderToStaticMarkup(<SummaryCard label="Open vacancies" value={2} href="/en/org/acme/jobs?status=open" icon={Briefcase} />);
    expect(html).toContain('href="/en/org/acme/jobs?status=open"');
    expect(html).toContain('aria-label="Open vacancies: 2"');
    const hinted = renderToStaticMarkup(<SummaryCard label="New applications" hint="in the last 7 days" value={3} href="/x" icon={Briefcase} />);
    expect(hinted).toContain('aria-label="New applications in the last 7 days: 3"');
    const described = renderToStaticMarkup(<SummaryCard label="My applications" detail="2 in progress" value={4} href="/x" icon={Briefcase} />);
    expect(described).toContain('aria-label="My applications: 4"');
    const id = /aria-describedby="([^"]+)"/.exec(described)?.[1];
    expect(described).toContain(`id="${id}"`);
    expect(described).toMatch(/>2 in progress</);
    const large = renderToStaticMarkup(<SummaryCard label="Applications" value={45210} href="/x" icon={Briefcase} />);
    expect(large).toContain('aria-label="Applications: 45,210"');
    expect(large).toMatch(/>45,210</);
  });

  it("lists the eight stages in pipeline order, zeros included, with column headers, a total and a link per stage", () => {
    const byStage = { applied: 3, viewed: 2, shortlisted: 1, interview: 1, offer: 0, hired: 1, rejected: 1, withdrawn: 1 };
    const table = (hrefFor?: (stage: string) => string) =>
      renderToStaticMarkup(
        <StageTable id="stages" title="Applicants by stage" description="All" countLabel="Applicants" totals={byStage} total={10} hrefFor={hrefFor} />,
      );
    const html = table((stage) => `/en/org/acme/applicants?stage=${stage}`);
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
    const rows = [...html.matchAll(/<th scope="row"[^>]*>(?:<a [^>]*href="([^"]+)"[^>]*>)?([^<]+)(?:<\/a>)?<\/th><td[^>]*>(?:.*?<span class="min-w-8[^"]*">)?([\d,]+)(?:<\/span><\/span>)?<\/td>/g)].map((m) => [m[2], m[3], m[1]]);
    expect(rows).toEqual([
      ["Applied", "3", "/en/org/acme/applicants?stage=applied"],
      ["Viewed", "2", "/en/org/acme/applicants?stage=viewed"],
      ["Shortlisted", "1", "/en/org/acme/applicants?stage=shortlisted"],
      ["Interview", "1", "/en/org/acme/applicants?stage=interview"],
      ["Offer", "0", "/en/org/acme/applicants?stage=offer"],
      ["Hired", "1", "/en/org/acme/applicants?stage=hired"],
      ["Not selected", "1", "/en/org/acme/applicants?stage=rejected"],
      ["Withdrawn", "1", "/en/org/acme/applicants?stage=withdrawn"],
      ["Total", "10", undefined],
    ]);
    expect(html).toContain('aria-labelledby="stages"');
    expect(table()).not.toContain("<a ");
  });

  it("draws each bar as a share of the largest stage, hidden from assistive technology, and no bar for a stage with none", () => {
    const html = renderToStaticMarkup(<StageBar value={1} max={4} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="25"');
    expect(renderToStaticMarkup(<StageBar value={0} max={4} />).match(/<rect/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<StageBar value={0} max={0} />).match(/<rect/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<StageBar value={1} max={100} />)).toContain('width="3"');
  });
});
