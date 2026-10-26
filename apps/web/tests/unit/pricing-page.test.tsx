import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PricingViewer, PublicPlan } from "@/lib/billing/pricing";

let plans: PublicPlan[] = [];
let partnerPlans: Record<string, PublicPlan[]> = {};
let viewer: PricingViewer = { kind: "visitor" };
let failure: Error | null = null;
let released = false;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/pricing", () => ({
  listPublicPlans: async (type = "employer") => {
    if (failure) throw failure;
    return type === "employer" ? plans : (partnerPlans[type] ?? []);
  },
  getPricingViewer: async () => viewer,
}));
vi.mock("@/lib/dal/release", () => ({ isReleased: async () => released }));

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
  partnerPlans = {
    recruitment_company: [
      plan({ code: "recruitment_partner", priceMinor: 4900, limits: { markets: 3, listed_occupations: 10, workforce_listings: 10, members: 1 }, features: ["worker_search"] }),
      plan({ code: "recruitment_enterprise", name: "Enterprise", priceMinor: 19900, contactSales: true, limits: { markets: null, listed_occupations: null, members: 15 }, features: [] }),
    ],
    staffing_company: [plan({ code: "staffing_partner", priceMinor: 5900, limits: { markets: 3, listed_occupations: 10, workforce_listings: 10, members: 1 }, features: [] })],
  };
  viewer = { kind: "visitor" };
  failure = null;
  released = false;
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

  it("has the client's heading, and a worker card that lists what a worker has and ends in Create worker profile for a visitor (D81)", async () => {
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html).toContain("Choose how you want to grow on Chara Pinnacle");
    const workers = html.slice(html.indexOf('id="pricing-workers"'), html.indexOf('id="pricing-employers"'));
    for (const item of ["Worker profile", "CHARA Passport", "Search jobs", "Apply", "Save jobs", "Manage applications"]) {
      expect(workers).toContain(`</svg>${item}</li>`);
    }
    expect(workers).toMatch(/<a [^>]*href="\/en\/signup\?kind=worker"[^>]*>Create worker profile<\/a>/);
    expect(html).not.toMatch(/recruitment compan|staffing compan/i);
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
    expect(html).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Start hiring<\/a>/);
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

  it("shows no tabs and no partner plan while release 2a is off", async () => {
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain(">Employers</h2>");
    expect(html).not.toContain("EUR 49.00");
  });
});

describe("the pricing tabs of the company types (FR-R1 AC3, release 2a)", () => {
  it("offers the employer, recruitment and staffing plans as labelled tabs, the first selected, and the others' panels hidden", async () => {
    released = true;
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html).toMatch(/<div role="tablist" aria-label="Plans by type of company"/);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>([^<]+)<\/button>/g)].map(
      (match) => [match[2], match[1]],
    );
    expect(tabs).toEqual([
      ["Employers", "true"],
      ["Recruitment companies", "false"],
      ["Staffing companies", "false"],
    ]);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html.match(/role="tabpanel"[^>]*hidden=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Recruitment company plans"');
    expect(html).toContain('aria-label="Staffing company plans"');
  });

  it("shows each partner plan with its price, trial and limits, Enterprise from its price with a contact link, and the sign-up as the type", async () => {
    released = true;
    const html = renderToStaticMarkup(await PricingPage(props));
    const recruitment = html.slice(html.indexOf('aria-label="Recruitment company plans"'), html.indexOf('aria-label="Staffing company plans"'));
    for (const text of ["EUR 49.00", "30 days free trial", "3 countries served", "10 occupations", "1 team member", "From EUR 199.00", "Unlimited occupations", "15 team members"]) {
      expect(recruitment).toContain(text);
    }
    expect(recruitment).not.toContain("workforce listings");
    expect(recruitment).toMatch(/<a [^>]*href="\/en\/signup\?kind=recruitment_company"[^>]*>Sign up for Basic<\/a>/);
    expect(recruitment).toMatch(/<a [^>]*href="\/en\/contact"[^>]*>Contact sales about Enterprise<\/a>/);
    const enterprise = recruitment.slice(recruitment.indexOf("Enterprise"));
    expect(enterprise).not.toContain("free trial");
    const staffing = html.slice(html.indexOf('aria-label="Staffing company plans"'));
    expect(staffing).toContain("EUR 59.00");
    expect(staffing).toContain("10 workforce listings");
    expect(html).toContain("A paid plan does not make a recruitment or staffing company verified or move it up in the partner directories.");
  });

  it("leads the owner of a staffing company to its billing page from the staffing plans only", async () => {
    released = true;
    viewer = { kind: "manager", slug: "manila", type: "staffing_company" };
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html.match(/href="\/en\/org\/manila\/billing"/g)).toHaveLength(1);
    const staffing = html.slice(html.indexOf('aria-label="Staffing company plans"'));
    expect(staffing).toMatch(/<a [^>]*href="\/en\/org\/manila\/billing"[^>]*>Choose Basic<\/a>/);
  });

  it("tells a worker that the plans are for companies", async () => {
    released = true;
    viewer = { kind: "worker" };
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html).toContain("Plans are for companies. Workers never pay.");
    expect(html).not.toContain("Plans are for employers");
  });

  it("shows the unavailable notice in a partner tab without public plans", async () => {
    released = true;
    partnerPlans = { recruitment_company: [], staffing_company: [] };
    const html = renderToStaticMarkup(await PricingPage(props));
    expect(html.match(/Pricing is currently unavailable/g)).toHaveLength(2);
    expect(html).toMatch(/<a [^>]*href="\/en\/signup\?kind=staffing_company"[^>]*>Create a company account<\/a>/);
  });
});
