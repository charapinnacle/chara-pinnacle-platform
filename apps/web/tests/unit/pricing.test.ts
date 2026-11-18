import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/billing/presentation";
import { planCard, planLink, viewerNote, type PricingViewer, type PublicPlan } from "@/lib/billing/pricing";

const BASIC: PublicPlan = {
  code: "employer_starter",
  name: "Basic",
  priceMinor: 3900,
  currency: "EUR",
  interval: "month",
  trialDays: 30,
  contactSales: false,
  limits: { active_jobs: 3, members: 1 },
  features: ["analytics_advanced", "csv_export", "shortlisting"],
};

describe("price formatting (FR-H2 AC7)", () => {
  it("keeps every cent and adds no VAT", () => {
    expect([3900, 7900, 4950, 0].map((minor) => formatPrice(minor, "EUR"))).toEqual([
      "EUR 39.00",
      "EUR 79.00",
      "EUR 49.50",
      "EUR 0.00",
    ]);
  });
});

describe("the card of a plan record (FR-H2 AC1, AC3, AC6)", () => {
  it("shows the name, the price excluding VAT and the trial terms of the record", () => {
    expect(planCard(BASIC)).toMatchObject({
      name: "Basic",
      price: "EUR 39.00",
      per: "per month",
      trial: [
        "30 days free trial",
        "Then EUR 39.00 per month excl. VAT.",
        "When the trial ends, your subscription converts to the paid Basic plan and your payment method is charged automatically. One free trial is granted for each legal entity.",
      ],
    });
  });

  it("follows the trial length, and shows no trial text for 0 days", () => {
    expect(planCard({ ...BASIC, trialDays: 14 }).trial[0]).toBe("14 days free trial");
    expect(planCard({ ...BASIC, trialDays: 0 }).trial).toEqual([]);
  });

  it("lists the limits of its own record and only the features that have a label", () => {
    expect(planCard(BASIC)).toMatchObject({
      limits: ["3 active vacancies", "1 team member"],
      features: ["Shortlisting of applicants", "CSV export of the applicant list"],
    });
    expect(planCard({ ...BASIC, limits: { active_jobs: 1, members: 5 } }).limits).toEqual(["1 active vacancy", "5 team members"]);
  });

  it("leaves out a limit without a number, a limit without a label and a feature of a later phase", () => {
    const card = planCard({
      ...BASIC,
      limits: { active_jobs: null, members: 15, active_requirements: 4, partner_invitations_per_requirement: null, corridors: 2 },
      features: ["chara_match", "corridors", "advanced_worker_search", "shortlisting"],
    });
    expect(card.limits).toEqual(["15 team members", "4 active workforce requirements"]);
    expect(card.features).toEqual(["Shortlisting of applicants"]);
  });

  it("shows no price and no trial for a plan that is sold by contact (FR-H2 AC5)", () => {
    expect(planCard({ ...BASIC, name: "Enterprise", contactSales: true })).toMatchObject({ price: null, trial: [] });
  });
});

describe("the link of a card by who reads the page (FR-H2 AC12)", () => {
  const basic = planCard(BASIC);
  const links = (viewer: PricingViewer) => planLink(viewer, basic, "en");

  it("sends a visitor to the sign-up and an owner or admin to the billing page of the organisation", () => {
    expect(links({ kind: "visitor" })).toEqual({ href: "/en/signup?kind=company", label: "Sign up for Basic" });
    expect(links({ kind: "manager", slug: "acme-bau", type: "employer" })).toEqual({ href: "/en/org/acme-bau/billing", label: "Choose Basic" });
  });

  it("gives a worker, a member and a person who has not finished setting up no link to buy", () => {
    expect([links({ kind: "worker" }), links({ kind: "member", type: "employer" }), links({ kind: "setup" }), links({ kind: "unknown" })]).toEqual([null, null, null, null]);
  });

  it("gives every reader the contact page for a plan sold by contact", () => {
    const enterprise = planCard({ ...BASIC, name: "Enterprise", contactSales: true });
    for (const viewer of [{ kind: "visitor" }, { kind: "worker" }, { kind: "member", type: "employer" }, { kind: "setup" }, { kind: "unknown" }] as const) {
      expect(planLink(viewer, enterprise, "en")).toEqual({ href: "/en/contact", label: "Contact sales about Enterprise" });
    }
  });

  it("tells a worker, a member and a person still setting up what applies to them", () => {
    expect(viewerNote({ kind: "visitor" }, "en")).toBeNull();
    expect(viewerNote({ kind: "manager", slug: "x", type: "employer" }, "en")).toBeNull();
    expect(viewerNote({ kind: "worker" }, "en")?.text).toBe("Plans are for employers. Workers never pay.");
    expect(viewerNote({ kind: "worker" }, "en", true)?.text).toBe("Plans are for companies. Workers never pay.");
    expect(viewerNote({ kind: "member", type: "employer" }, "en")?.text).toBe("The owner or an admin of your organisation manages its plan.");
    expect(viewerNote({ kind: "setup" }, "en")?.link?.href).toBe("/en/onboarding");
    expect(viewerNote({ kind: "unknown" }, "en")).toBeNull();
  });
});

const PARTNER_BASIC: PublicPlan = {
  code: "staffing_partner",
  name: "Basic",
  priceMinor: 5900,
  currency: "EUR",
  interval: "month",
  trialDays: 30,
  contactSales: false,
  limits: {
    active_jobs: 0,
    markets: 3,
    listed_occupations: 10,
    workforce_listings: 10,
    members: 1,
    job_order_responses_per_month: 10,
    candidate_submissions_per_month: 25,
    messages_per_month: 100,
  },
  features: ["job_order_access", "worker_search", "employer_discovery", "analytics_basic"],
};

describe("the cards of the partner plans (FR-R1 AC3)", () => {
  it("shows the price, the trial, the limits of the workforce profile and the team, and the responses and submissions", () => {
    const card = planCard(PARTNER_BASIC, "staffing_company");
    expect(card).toMatchObject({ price: "EUR 59.00", per: "per month", features: [] });
    expect(card.trial[0]).toBe("30 days free trial");
    expect(card.limits).toEqual([
      "3 countries served",
      "10 occupations",
      "10 workforce listings",
      "1 team member",
      "10 responses to workforce requests per month",
    ]);
    expect(planCard({ ...PARTNER_BASIC, code: "recruitment_partner" }, "recruitment_company").limits).toEqual([
      "3 countries served",
      "10 occupations",
      "10 workforce listings",
      "1 team member",
      "10 job order responses per month",
      "25 candidate submissions per month",
    ]);
    expect(card.limits.join(" ")).not.toMatch(/message/i);
  });

  it("lists the workforce requirements and partner invitations of an employer plan from its record", () => {
    const card = planCard({ ...BASIC, limits: { active_jobs: 3, members: 1, active_requirements: 3, partner_invitations_per_requirement: 1 } });
    expect(card.limits).toEqual(["3 active vacancies", "1 team member", "3 active workforce requirements", "1 partner invitation per requirement"]);
  });

  it("lists a partner limit without a value as unlimited", () => {
    const card = planCard(
      {
        ...PARTNER_BASIC,
        limits: { markets: null, listed_occupations: null, workforce_listings: null, members: 15, job_order_responses_per_month: null },
      },
      "staffing_company",
    );
    expect(card.limits).toEqual([
      "Unlimited countries served",
      "Unlimited occupations",
      "Unlimited workforce listings",
      "15 team members",
      "Unlimited responses to workforce requests per month",
    ]);
  });

  it("states the price a contact-sales partner plan starts from, without a trial, and keeps the employer one without a price", () => {
    const enterprise = { ...PARTNER_BASIC, name: "Enterprise", priceMinor: 24900, contactSales: true };
    expect(planCard(enterprise, "staffing_company")).toMatchObject({ price: "From EUR 249.00", trial: [] });
    expect(planCard(enterprise)).toMatchObject({ price: null, trial: [] });
    expect(planCard({ ...enterprise, priceMinor: 0 }, "staffing_company").price).toBeNull();
  });
});

describe("the link of a partner card (FR-R1 AC3, AC4)", () => {
  const basic = planCard(PARTNER_BASIC, "staffing_company");

  it("signs a visitor up as a company of the tab's type", () => {
    expect(planLink({ kind: "visitor" }, basic, "en", "staffing_company")).toEqual({
      href: "/en/signup?kind=staffing_company",
      label: "Sign up for Basic",
    });
    expect(planLink({ kind: "visitor" }, basic, "en", "recruitment_company")?.href).toBe("/en/signup?kind=recruitment_company");
  });

  it("leads an owner or admin to the billing page only from the plans of the own organisation's type", () => {
    expect(planLink({ kind: "manager", slug: "manila", type: "staffing_company" }, basic, "en", "staffing_company")).toEqual({
      href: "/en/org/manila/billing",
      label: "Choose Basic",
    });
    expect(planLink({ kind: "manager", slug: "manila", type: "staffing_company" }, basic, "en", "recruitment_company")).toBeNull();
    expect(planLink({ kind: "manager", slug: "manila", type: "staffing_company" }, planCard(BASIC), "en")).toBeNull();
    expect(planLink({ kind: "manager", slug: "acme", type: "employer" }, basic, "en", "staffing_company")).toBeNull();
  });
});

describe("the features of Phase 2 on a card (FR-L5 AC7)", () => {
  const every = ["release_partner_directories", "release_job_orders", "release_candidate_submissions", "release_messaging", "release_find_workers"] as const;

  it("lists a delivered feature only while its release is on, and a feature without a label never", () => {
    const employer = { ...BASIC, features: ["advanced_partner_search", "available_workforce_search", "multi_country_requirements"] };
    expect(planCard(employer).features).toEqual([]);
    expect(planCard(employer, "employer", ["release_partner_directories"]).features).toEqual([
      "Advanced partner search filters",
      "Available workforce search",
    ]);
    const partner = { ...PARTNER_BASIC, features: ["job_order_access", "employer_discovery", "worker_search", "analytics_basic"] };
    expect(planCard(partner, "staffing_company", ["release_partner_directories"]).features).toEqual([]);
    expect(planCard(partner, "staffing_company", ["release_job_orders"]).features).toEqual([
      "Job order access",
      "Find employers by destination and industry",
    ]);
  });

  it("says on no card that a plan verifies a company or raises it in search", () => {
    const all = ["shortlisting", "csv_export", "advanced_partner_search", "available_workforce_search", "job_order_access"];
    const texts = [planCard({ ...BASIC, features: all }, "employer", every), planCard({ ...PARTNER_BASIC, features: all }, "recruitment_company", every)]
      .flatMap((card) => [...card.features, ...card.limits, ...card.trial])
      .join(" ")
      .toLowerCase();
    expect(texts).not.toMatch(/verif|rank|priority|higher|top of|featured|boost/);
  });
});
