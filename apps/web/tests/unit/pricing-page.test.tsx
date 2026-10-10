import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PricingViewer, PublicPlan } from "@/lib/billing/pricing";

let plans: PublicPlan[] = [];
let viewer: PricingViewer = { kind: "visitor" };
let failure: Error | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/pricing", () => ({
  listPublicPlans: async () => {
    if (failure) throw failure;
    return plans;
  },
  getPricingViewer: async () => viewer,
}));

const { default: PricingPage } = await import("@/app/[lang]/(public)/pricing/page");

const props = { params: Promise.resolve({ lang: "en" }) } as Parameters<typeof PricingPage>[0];

const plan = (overrides: Partial<PublicPlan>): PublicPlan => ({
  code: "employer_starter",
  name: "Basic",
  priceMinor: 3900,
  currency: "EUR",
  interval: "month",
  trialDays: 30,
  contactSales: false,
  limits: { active_jobs: 3, members: 1 },
  features: ["shortlisting", "csv_export", "analytics_advanced"],
  ...overrides,
});

beforeEach(() => {
  plans = [plan({}), plan({ code: "employer_professional", name: "Professional", priceMinor: 7900, limits: { active_jobs: 15, members: 5 } })];
  viewer = { kind: "visitor" };
  failure = null;
});

describe("the pricing page (FR-H2)", () => {
  it("renders one card per plan record, in the order given, with the price excluding VAT and the limits of its own record", async () => {
    const html = renderToStaticMarkup(await PricingPage(props));

    expect(html.indexOf("Basic")).toBeLessThan(html.indexOf("Professional"));
    for (const text of ["EUR 39.00", "EUR 79.00", "excl. VAT", "30 days free trial", "3 active vacancies", "15 active vacancies", "5 team members"]) {
      expect(html).toContain(text);
    }
    expect(html.match(/<h3/g)).toHaveLength(2);
  });

  it("lists only features with a label and never promises a feature of a later phase", async () => {
    const html = renderToStaticMarkup(await PricingPage(props));

    expect(html).toContain("Shortlisting of applicants");
    expect(html).not.toContain("analytics_advanced");
    expect(html).not.toMatch(/boost|badge|corridor|messaging|CHARA Match/i);
  });

  it("states that a paid plan buys neither verification nor ranking (AC10)", async () => {
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html).toContain("A paid plan does not make an organisation verified or move its vacancies up in search results.");
  });

  it("shows the worker statement and no checkout link for workers", async () => {
    viewer = { kind: "worker" };
    const html = renderToStaticMarkup(await PricingPage(props));

    expect(html).toContain("Workers never pay");
    expect(html).toContain("Plans are for employers");
    expect(html).not.toContain("/en/signup");
    expect(html).not.toContain("/billing");
  });

  it("replaces the employer cards by a notice with a link to the contact page when no plan is public (AC11)", async () => {
    plans = [];
    const html = renderToStaticMarkup(await PricingPage(props));

    expect(html).toContain("Pricing is currently unavailable");
    expect(html).toContain('href="/en/contact"');
    expect(html).not.toContain("<h3");
    expect(html).toContain("Workers never pay");
  });

  it("marks only the configured plan as recommended, and nothing when that plan is not public", async () => {
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html.match(/Recommended/g)).toHaveLength(1);
    expect(html.indexOf("Recommended")).toBeGreaterThan(html.indexOf("Professional"));

    plans = [plan({})];
    expect(renderToStaticMarkup(await PricingPage(props))).not.toContain("Recommended");
  });

  it("does not catch a failed read, so that the error page shows", async () => {
    failure = new Error("The plans could not be loaded");
    await expect(PricingPage(props)).rejects.toThrow("The plans could not be loaded");
  });
});
