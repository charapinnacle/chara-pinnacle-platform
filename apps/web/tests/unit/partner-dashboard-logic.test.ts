import { describe, expect, it } from "vitest";
import {
  dashboardTarget,
  nextActions,
  profileViewsText,
  segmentOf,
  usageAttention,
  usageLine,
  type PartnerFigures,
} from "@/lib/dashboard/partner-dashboard";
import { listingFreshness } from "@/lib/validation/workforce-availability";

const r = { slug: "r", type: "recruitment_company" as const };
const s = { slug: "s", type: "staffing_company" as const };
const a = { slug: "a", type: "employer" as const };

describe("dashboardTarget (FR-R3 AC2, FR-R4 AC2)", () => {
  it("names the segment of each organisation type", () => {
    expect([segmentOf("employer"), segmentOf("recruitment_company"), segmentOf("staffing_company")]).toEqual([
      "employer",
      "recruitment",
      "staffing",
    ]);
  });

  it("shows the organisation of the address under its own segment and redirects any other", () => {
    expect(dashboardTarget("recruitment", "r", [a, r])).toEqual({ kind: "partner", organization: r });
    expect(dashboardTarget("employer", "a", [a, r])).toEqual({ kind: "employer" });
    expect(dashboardTarget("recruitment", "a", [a, r])).toEqual({ kind: "redirect", segment: "employer", slug: "a" });
    expect(dashboardTarget("employer", "r", [a, r])).toEqual({ kind: "redirect", segment: "recruitment", slug: "r" });
    expect(dashboardTarget("recruitment", "s", [s])).toEqual({ kind: "redirect", segment: "staffing", slug: "s" });
  });

  it("sends an outsider of a partner to the own dashboard and leaves the employer answer to the employer page", () => {
    expect(dashboardTarget("staffing", "s", [r])).toEqual({ kind: "redirect", segment: "employer" });
    expect(dashboardTarget("employer", "s", [r])).toEqual({ kind: "employer" });
  });

  it("without an address takes the first organisation, or the first of the segment's type", () => {
    expect(dashboardTarget("employer", undefined, [r, a])).toEqual({ kind: "redirect", segment: "recruitment", slug: "r" });
    expect(dashboardTarget("employer", undefined, [a, r])).toEqual({ kind: "employer" });
    expect(dashboardTarget("employer", undefined, [])).toEqual({ kind: "employer" });
    expect(dashboardTarget("recruitment", undefined, [a, s, r])).toEqual({ kind: "partner", organization: r });
    expect(dashboardTarget("staffing", undefined, [a, r])).toEqual({ kind: "redirect", segment: "employer" });
  });
});

const figures = (over: Partial<PartnerFigures> = {}): PartnerFigures => ({
  reviewStatus: "listed",
  listed: true,
  profileHidden: false,
  profileMissing: null,
  profileUpdatedAt: null,
  listingsTotal: 2,
  listingsDue: 0,
  listingsStale: 0,
  licencesCurrent: 1,
  licencesExpiring: 0,
  licencesExpired: 0,
  nextLicenceExpiry: null,
  profileViews: 0,
  profileViewsFewerThan: null,
  profileViewsInPlan: true,
  ...over,
});

describe("nextActions (SOP P2-37 purpose, NFR-U4)", () => {
  it("has nothing for a complete company and nothing for a member", () => {
    expect(nextActions(figures(), true)).toEqual([]);
    expect(nextActions(figures({ listingsStale: 3, profileMissing: "occupations" }), false)).toEqual([]);
  });

  it("lists the request of our team, the missing profile part, listings and licences, most urgent first", () => {
    const actions = nextActions(
      figures({
        reviewStatus: "info_requested",
        profileMissing: "employer_pays_commitment",
        listingsStale: 1,
        listingsDue: 2,
        licencesExpired: 1,
        licencesExpiring: 2,
      }),
      true,
    );
    expect(actions.map(({ text, target }) => `${target}: ${text}`)).toEqual([
      "onboarding: Answer the request of our team and submit your company again",
      "commitment: Add the employer-pays commitment to complete your workforce profile",
      "availability: Confirm 1 listing hidden from search",
      "availability: Confirm 2 listings due for confirmation",
      "licences: Renew 1 expired licence",
      "licences: Update 2 licences that expire soon",
    ]);
  });

  it("guides an empty company to its listings and licences, and an identifier to the company step", () => {
    expect(nextActions(figures({ listingsTotal: 0, licencesCurrent: 0, profileMissing: "legal_entity_identifier" }), true)).toEqual([
      { id: "profile", text: "Add your company registration number or other identifier to complete your workforce profile", target: "company" },
      { id: "listings", text: "Add the workers you can supply, by country and occupation", target: "availability" },
      { id: "licences", text: "Add the licence you hold for each country where you work", target: "licences" },
    ]);
  });
});

describe("usageLine (FR-R4 AC8)", () => {
  const usage = {
    planName: "Partner",
    items: {
      workforce_listings: { used: 7, limit: 10, applies: true, resetsAt: null },
      markets: { used: 7, limit: null, applies: true, resetsAt: null },
      listed_occupations: { used: 1, limit: 10, applies: false, resetsAt: null },
    },
  };

  it("says the usage against the plan's limit, enforced or not yet, or the usage with no limit when the plan has none", () => {
    expect(usageLine(usage, "workforce_listings", "staffing_company")).toBe("7 of 10 workforce listings");
    expect(usageLine(usage, "markets", "staffing_company")).toBe("7 countries served (no limit)");
    expect(usageLine(usage, "listed_occupations", "recruitment_company")).toBe("1 of 10 occupations listed");
    expect(usageLine(usage, "members", "recruitment_company")).toBeNull();
  });
});

describe("usageAttention (FR-R1 AC2, AC8)", () => {
  const usage = {
    planName: "Free",
    items: {
      members: { used: 1, limit: 0, applies: true, resetsAt: null },
      workforce_listings: { used: 10, limit: 10, applies: true, resetsAt: null },
      markets: { used: 2, limit: 3, applies: true, resetsAt: null },
      listed_occupations: { used: 40, limit: null, applies: true, resetsAt: null },
    },
  };

  it("marks a limit the usage is over or at, so the card names it with the way to upgrade, and nothing within or without a limit", () => {
    expect(usageLine(usage, "members", "staffing_company")).toBe("1 of 0 team members");
    expect(usageAttention(usage, "members")).toBe("over_limit");
    expect(usageAttention(usage, "workforce_listings")).toBe("at_limit");
    expect(usageAttention(usage, "markets")).toBeNull();
    expect(usageAttention(usage, "listed_occupations")).toBeNull();
    expect(usageAttention(usage, "active_jobs")).toBeNull();
  });
});

describe("profileViewsText (FR-R3 AC10)", () => {
  it("never shows a hidden count", () => {
    expect(profileViewsText({ profileViews: null, profileViewsFewerThan: 5 })).toBe("fewer than 5");
    expect(profileViewsText({ profileViews: 7, profileViewsFewerThan: null })).toBe("7");
    expect(profileViewsText({ profileViews: 1200, profileViewsFewerThan: null })).toBe("1,200");
  });
});

// FR-R4 AC4: the classifier of listings at the staleness boundary. The dashboard uses the classifier of FR-K3, which
// follows the read policy of workforce_availability (fresh while confirmed_at > now() - 60 days), so exactly 60 days is
// already stale; the criterion's "60 days is current" is recorded as a departure.
describe("listing staleness at the boundary (FR-R4 AC4)", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const rules = { staleDays: 60, reminderDays: 30, maxDays: 730 };
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const DAY = 86_400_000;

  it("keeps 59 days current and makes 60 days and 1 minute and 200 days stale", () => {
    expect(listingFreshness(ago(59 * DAY), now, rules).state).not.toBe("hidden");
    expect(listingFreshness(ago(60 * DAY + 60_000), now, rules).state).toBe("hidden");
    expect(listingFreshness(ago(200 * DAY), now, rules).state).toBe("hidden");
    expect(listingFreshness(ago(60 * DAY), now, rules).state).toBe("hidden");
  });
});
