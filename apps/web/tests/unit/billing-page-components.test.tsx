import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlanActions } from "@/components/billing/plan-actions";
import { PlanChoices } from "@/components/billing/plan-choices";
import { PlanSummary } from "@/components/billing/plan-summary";
import { UsageSection } from "@/components/billing/usage-section";
import type { PlanChange, SoldPlan } from "@/lib/billing/presentation";
import type { Subscription, Usage } from "@/lib/dal/billing";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/billing", () => ({ openPortal: vi.fn() }));

const BASIC: SoldPlan = { code: "employer_starter", name: "Basic", priceMinor: 3900, currency: "EUR", interval: "month", trialDays: 30 };
const PROFESSIONAL: SoldPlan = { ...BASIC, code: "employer_professional", name: "Professional", priceMinor: 7900 };
const subscription = (over: Partial<Subscription>): Subscription => ({
  planCode: "employer_starter",
  planName: "Basic",
  status: "active",
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAt: null,
  pastDueSince: null,
  ...over,
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the usage bars (FR-G5 AC7, AC12)", () => {
  const render = (usage: Usage[], upgradeHref: string | null = "#plan-actions") =>
    renderToStaticMarkup(<UsageSection usage={usage} upgradeHref={upgradeHref} />);

  it("gives each bar the role, the label, the value and the maximum, and the figures in words", () => {
    const html = render([
      { key: "active_jobs", used: 7, limit: 15 },
      { key: "members", used: 3, limit: 5 },
    ]);
    expect(html).toContain('role="progressbar" aria-label="Open vacancies" aria-valuemin="0" aria-valuemax="15" aria-valuenow="7" aria-valuetext="7 of 15"');
    expect(html).toContain('aria-label="Team members" aria-valuemin="0" aria-valuemax="5" aria-valuenow="3"');
    expect(text(html)).toContain("Open vacancies 7 of 15");
    expect(text(html)).toContain("Team members 3 of 5");
    expect(html).not.toContain("Limit reached");
  });

  it("says Limit reached with an Upgrade link at the limit, and no link when no upgrade exists", () => {
    const at = [{ key: "active_jobs", used: 3, limit: 3 }] satisfies Usage[];
    expect(text(render(at))).toContain("3 of 3 Limit reached");
    expect(render(at)).toContain('aria-label="Upgrade (Open vacancies)" href="#plan-actions"');
    expect(render(at, null)).not.toContain("<a");
  });

  it("says that a plan over its limit keeps its data, and keeps the bar at the maximum", () => {
    const html = render([{ key: "active_jobs", used: 5, limit: 3 }]);
    expect(text(html)).toContain("5 of 3 Over the limit");
    expect(text(html)).toContain("Existing vacancies stay open. No more can be opened until usage is below the limit.");
    expect(html).toContain('aria-valuemax="3" aria-valuenow="3"');
    expect(html).toContain("width:100%");
  });

  it("shows Unlimited as text without a bar", () => {
    const html = render([{ key: "members", used: 4, limit: null }]);
    expect(text(html)).toContain("Team members Unlimited");
    expect(html).not.toContain("progressbar");
  });
});

describe("the plan summary (FR-G5 AC1, AC4, AC5, AC9)", () => {
  it("shows the plan name from the record, the status in words and the dates", () => {
    const html = text(
      renderToStaticMarkup(
        <PlanSummary subscription={subscription({ status: "trialing", trialEndsAt: "2026-11-04T00:00:00Z" })} plan={BASIC} />,
      ),
    );
    expect(html).toContain("Plan Basic Status Trial");
    expect(html).toContain("Trial ends 4 Nov 2026");
    expect(html).toContain("First payment of EUR 39.00 excl. VAT on 4 Nov 2026");
  });

  it("shows No active plan with the read-only free plan and a way to choose, for a lapsed organisation", () => {
    const html = renderToStaticMarkup(<PlanSummary subscription={subscription({ status: "canceled" })} plan={BASIC} />);
    expect(text(html)).toContain("Plan No active plan");
    expect(text(html)).toContain("Free plan with read-only access to past applicants.");
    expect(html).toContain('href="#plans"');
    expect(text(html)).not.toContain("Basic");
  });

  it("shows the free plan and No subscription for an organisation that never subscribed", () => {
    const html = text(renderToStaticMarkup(<PlanSummary subscription={null} plan={undefined} />));
    expect(html).toContain("Plan Free plan Status No subscription");
    expect(html).not.toContain("Choose a plan");
  });
});

describe("the plan choices (FR-G5 AC9)", () => {
  const render = (offerTrial: boolean) =>
    renderToStaticMarkup(<PlanChoices plans={[BASIC, PROFESSIONAL]} checkoutHref={(code) => `/x?plan=${code}`} offerTrial={offerTrial} />);

  it("offers a trial of the length of the plan record to an organisation that never subscribed", () => {
    const html = render(true);
    expect(html).toContain('aria-label="Start 30-day free trial of Basic" href="/x?plan=employer_starter"');
    expect(text(html)).toContain("EUR 39.00 per month excl. VAT");
    expect(text(html)).toContain("EUR 79.00 per month excl. VAT");
    expect(html).not.toContain("Subscribe");
  });

  it("offers Subscribe, with no trial, to an organisation that had a subscription", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Subscribe to Professional"');
    expect(html).not.toContain("free trial of");
    expect(text(html)).toContain("No free trial");
  });

  it("offers no trial for a plan whose record has none", () => {
    const html = renderToStaticMarkup(
      <PlanChoices plans={[{ ...BASIC, trialDays: 0 }]} checkoutHref={(code) => `/x?plan=${code}`} offerTrial />,
    );
    expect(html).toContain("Subscribe to Basic");
  });
});

describe("the portal controls (FR-G5 AC8)", () => {
  const upgrade: PlanChange = { kind: "upgrade", label: "Upgrade to Professional", plan: PROFESSIONAL };

  it("shows the plan change, Manage billing, Change tax details and View invoices for a live plan", () => {
    const html = renderToStaticMarkup(<PlanActions slug="acme" changes={[upgrade]} live />);
    for (const label of ["Upgrade to Professional", "Manage billing", "Change tax details", "View invoices"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).not.toContain("Enterprise");
  });

  it("shows only View invoices for a lapsed organisation", () => {
    const html = renderToStaticMarkup(<PlanActions slug="acme" changes={[]} live={false} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(">View invoices</button>");
  });
});
