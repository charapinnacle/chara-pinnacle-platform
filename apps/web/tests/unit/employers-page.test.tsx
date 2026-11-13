import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPlan } from "@/lib/billing/pricing";

let plans: PublicPlan[] = [];
let failure: Error | null = null;
const getPostJobHref = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn());
const logged = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/organizations", () => ({ getPostJobHref }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser }));
vi.mock("@/lib/dal/pricing", () => ({
  listPublicPlans: async () => {
    if (failure) throw failure;
    return plans;
  },
}));

const { default: EmployersPage } = await import("@/app/[lang]/(public)/employers/page");

async function render(): Promise<string> {
  const { prelude } = await prerender(await EmployersPage({ params: Promise.resolve({ lang: "en" }) } as Parameters<typeof EmployersPage>[0]));
  return new Response(prelude).text();
}

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const teaserOf = (markup: string) => /<section class="border-t" id="pricing"[^>]*>(.*?)<\/section>/.exec(markup)?.[1] ?? "";

const plan = (overrides: Partial<PublicPlan>): PublicPlan => ({
  code: "employer_starter",
  name: "Basic",
  priceMinor: 3900,
  currency: "EUR",
  interval: "month",
  trialDays: 30,
  contactSales: false,
  limits: {},
  features: [],
  ...overrides,
});

beforeEach(() => {
  plans = [
    plan({ code: "employer_professional", name: "Professional", priceMinor: 7900 }),
    plan({}),
    plan({ code: "employer_enterprise", name: "Enterprise", priceMinor: 100, contactSales: true }),
  ];
  failure = null;
  getPostJobHref.mockResolvedValue("/en/signup?kind=company");
  getCurrentUser.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(logged);
  logged.mockClear();
});

describe("the For employers page (U73, FR-H1, FR-H2)", () => {
  it("sends a signed-in worker to the home page, and serves a company and a visitor", async () => {
    getCurrentUser.mockResolvedValue({ accountKind: "worker" });
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;replace;/en;") });
    getCurrentUser.mockResolvedValue({ accountKind: "company" });
    expect(await render()).toContain("employers-heading");
  });

  it("has one h1 and the sections in order: steps, what you get, pricing, the closing call", async () => {
    const html = await render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 id="employers-heading"[^>]*>Hire from the Global Workforce Network.<\/h1>/);
    const order = ["employers-heading", "employers-steps-heading", "employers-facts-heading", "employers-pricing-heading", "employers-start-heading"].map((id) =>
      html.indexOf(`id="${id}"`),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect([...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(([, title]) => title)).toEqual([
      "Publish a vacancy",
      "Review applicants in one pipeline",
      "Hire and keep everyone informed",
    ]);
    expect(html).not.toContain("<details");
  });

  it("leads both Post a Job buttons where the header does, and offers none to whom the header offers none", async () => {
    getPostJobHref.mockResolvedValue("/en/post-job");
    expect((await render()).match(/<a [^>]*href="\/en\/post-job"[^>]*>Post a job<\/a>/g)).toHaveLength(2);
    getPostJobHref.mockResolvedValue(null);
    const candidate = await render();
    expect(candidate).not.toContain("Post a job");
    expect(candidate).toContain("Ready to hire?");
  });

  it("shows the price of the lowest plan with a price, its name and its trial terms from the records, and links to the pricing page", async () => {
    const teaser = teaserOf(await render());
    expect(textOf(teaser)).toContain("EUR 39.00 per month, excluding VAT");
    expect(textOf(teaser)).toContain("Basic plan. 30 days free trial. When the trial ends, your subscription converts to the paid Basic plan and your payment method is charged automatically. One free trial is granted for each legal entity. Higher plans are on the pricing page.");
    expect(textOf(teaser)).not.toContain("EUR 1.00");
    expect(teaser).toMatch(/<a [^>]*href="\/en\/pricing"[^>]*>See all plans<\/a>/);
  });

  it("follows a change of the records: a new lowest price and no trial text without trial days", async () => {
    plans = [plan({ name: "Starter", priceMinor: 4900, trialDays: 0 }), plan({ code: "employer_professional", name: "Professional", priceMinor: 7900 })];
    const teaser = textOf(teaserOf(await render()));
    expect(teaser).toContain("EUR 49.00 per month, excluding VAT");
    expect(teaser).toContain("Starter plan. Higher plans are on the pricing page.");
    expect(teaser).not.toContain("trial");
  });

  it("serves the page with the link alone when there is no plan with a price or the plans cannot be read", async () => {
    plans = [plan({ contactSales: true })];
    expect(textOf(teaserOf(await render()))).toContain("The plans and their prices are on the pricing page.");
    failure = new Error("connection refused");
    const html = await render();
    expect(textOf(teaserOf(html))).toContain("The plans and their prices are on the pricing page.");
    expect(html).not.toContain("connection refused");
    expect(logged).toHaveBeenCalledWith("The plans of the For employers page could not be loaded", failure);
  });

  it("states only enforced facts and nothing of a later phase, without a photograph or a style attribute", async () => {
    const html = await render();
    const text = textOf(html);
    for (const fact of ["Your team, with roles", "Two-step verification", "Documents opened safely", "Reporting and moderation"]) expect(text).toContain(fact);
    expect(text).toContain("Invite colleagues as administrators or members, up to the team size of your plan.");
    expect(text).toContain("Owners and administrators confirm a second step before they open applicants, the team, the company profile or billing.");
    for (const phrase of ["recruitment", "staffing", "verified", "every opening", "every page", "CHARA Match", "corridor"]) expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
    expect(html).not.toMatch(/<(img|picture)\b|\sstyle=/);
  });
});
