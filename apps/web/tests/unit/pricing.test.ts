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
        "30-day free trial",
        "Then EUR 39.00 per month excl. VAT.",
        "The trial converts automatically to the paid Basic plan. One free trial is granted per legal entity.",
      ],
    });
  });

  it("follows the trial length, and shows no trial text for 0 days", () => {
    expect(planCard({ ...BASIC, trialDays: 14 }).trial[0]).toBe("14-day free trial");
    expect(planCard({ ...BASIC, trialDays: 0 }).trial).toEqual([]);
  });

  it("lists the limits of its own record and only the features that have a label", () => {
    expect(planCard(BASIC)).toMatchObject({
      limits: ["3 active vacancies", "1 team member"],
      features: ["Shortlisting of applicants", "CSV export of the applicant list"],
    });
    expect(planCard({ ...BASIC, limits: { active_jobs: 1, members: 5 } }).limits).toEqual(["1 active vacancy", "5 team members"]);
  });

  it("leaves out a limit without a number, a limit of a later phase and a feature of a later phase", () => {
    const card = planCard({
      ...BASIC,
      limits: { active_jobs: null, members: 15, active_requirements: 4 },
      features: ["chara_match", "corridors", "advanced_worker_search", "shortlisting"],
    });
    expect(card.limits).toEqual(["15 team members"]);
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
    expect(links({ kind: "visitor" })).toEqual({ href: "/en/signup", label: "Sign up for Basic" });
    expect(links({ kind: "manager", slug: "acme-bau" })).toEqual({ href: "/en/org/acme-bau/billing", label: "Choose Basic" });
  });

  it("gives a worker, a member and a person who has not finished setting up no link to buy", () => {
    expect([links({ kind: "worker" }), links({ kind: "member" }), links({ kind: "setup" })]).toEqual([null, null, null]);
  });

  it("gives every reader the contact page for a plan sold by contact", () => {
    const enterprise = planCard({ ...BASIC, name: "Enterprise", contactSales: true });
    for (const kind of ["visitor", "worker", "member", "setup"] as const) {
      expect(planLink({ kind }, enterprise, "en")).toEqual({ href: "/en/contact", label: "Contact sales about Enterprise" });
    }
  });

  it("tells a worker, a member and a person still setting up what applies to them", () => {
    expect(viewerNote({ kind: "visitor" }, "en")).toBeNull();
    expect(viewerNote({ kind: "manager", slug: "x" }, "en")).toBeNull();
    expect(viewerNote({ kind: "worker" }, "en")?.text).toBe("Plans are for employers. Workers never pay.");
    expect(viewerNote({ kind: "member" }, "en")?.text).toBe("The owner or an admin of your organisation manages its plan.");
    expect(viewerNote({ kind: "setup" }, "en")?.link?.href).toBe("/en/onboarding");
  });
});
