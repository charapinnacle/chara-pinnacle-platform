import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartnerFigures } from "@/lib/dashboard/partner-dashboard";
import type { ReviewOutcome } from "@/lib/dal/partner-review";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";
import type { MemberRole } from "@/lib/validation/team";

const figuresMock = vi.hoisted(() => vi.fn());
const reviewMock = vi.hoisted(() => vi.fn());
const outcomeMock = vi.hoisted(() => vi.fn<() => Promise<ReviewOutcome | null>>(async () => null));
const followersMock = vi.hoisted(() => vi.fn(async () => ({ fewerThan: 5 })));
const planMock = vi.hoisted(() => vi.fn());
const usageMock = vi.hoisted(() => vi.fn());
const listingsMock = vi.hoisted(() => vi.fn<() => Promise<WorkforceListing[]>>(async () => []));
const twoStepMock = vi.hoisted(() => vi.fn(async () => true));
const releasedMock = vi.hoisted(() => vi.fn<(name: string) => Promise<boolean>>(async () => false));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/workforce-availability", () => ({ confirmListing: vi.fn(), deleteListing: vi.fn(), saveListing: vi.fn() }));
vi.mock("@/lib/dal/partner-dashboard", () => ({ getPartnerFigures: figuresMock }));
vi.mock("@/lib/dal/partner-review", () => ({
  getPartnerReview: reviewMock,
  getReviewOutcome: outcomeMock,
  getReviewTargetDays: async () => 1,
}));
vi.mock("@/lib/dal/connections", () => ({ getFollowerCount: followersMock }));
vi.mock("@/lib/dal/dashboard", () => ({ getDashboardPlan: planMock }));
vi.mock("@/lib/dal/usage", () => ({ getOrgUsage: usageMock }));
vi.mock("@/lib/dal/mfa", () => ({ hasVerifiedTotpFactor: twoStepMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/workforce-availability", () => ({
  getWorkforceListings: listingsMock,
  getAvailabilityRules: async () => ({ staleDays: 60, reminderDays: 30, maxDays: 730 }),
}));
vi.mock("@/lib/dal/reference", () => ({
  getOccupations: async () => [{ code: "7212", label: "Welders and flame cutters", synonyms: [] }],
  getCountries: async () => [{ code: "PH", name: "Philippines" }],
}));

const { PartnerDashboard } = await import("@/components/dashboard/partner-dashboard");

const DAY = 86_400_000;
const figures = (over: Partial<PartnerFigures> = {}): PartnerFigures => ({
  reviewStatus: "listed",
  listed: true,
  profileHidden: false,
  profileMissing: null,
  profileUpdatedAt: "2026-10-20T10:00:00Z",
  listingsTotal: 1,
  listingsDue: 0,
  listingsStale: 0,
  licencesCurrent: 1,
  licencesExpiring: 0,
  licencesExpired: 0,
  nextLicenceExpiry: "2027-05-01",
  profileViews: 12,
  profileViewsFewerThan: null,
  profileViewsInPlan: true,
  ...over,
});
const listing = (id: string, daysAgo: number): WorkforceListing => ({
  id,
  occupation: "7212",
  country: "PH",
  available: 25,
  monthlyCapacity: 5,
  availableFrom: "2026-11-01",
  confirmedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
});

type Options = { role?: MemberRole; aal?: string; type?: "recruitment_company" | "staffing_company" };

const render = async ({ role = "owner", aal = "aal2", type = "recruitment_company" }: Options = {}) => {
  const element = await PartnerDashboard({
    lang: "en",
    user: { aal },
    organization: { id: "org-9", slug: "manila-skills", displayName: "Manila Skills", role, type },
  });
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->|<!--\/?\$-->/g, "");
};

beforeEach(() => {
  vi.clearAllMocks();
  figuresMock.mockResolvedValue(figures());
  reviewMock.mockResolvedValue({ status: "listed", submittedAt: null, infoStep: null, listedAt: "2026-10-01T10:00:00Z" });
  planMock.mockResolvedValue({
    planName: "Partner",
    status: "trialing",
    trialEndsAt: new Date("2026-11-20T10:00:00Z"),
    currentPeriodEnd: null,
    pastDueSince: null,
    subscriptionEnded: false,
  });
  usageMock.mockResolvedValue({
    planName: "Partner",
    items: {
      markets: { used: 2, limit: 3, applies: true, resetsAt: null },
      listed_occupations: { used: 4, limit: 10, applies: true, resetsAt: null },
      workforce_listings: { used: 7, limit: null, applies: true, resetsAt: null },
      members: { used: 1, limit: 3, applies: true, resetsAt: null },
    },
  });
  listingsMock.mockResolvedValue([listing("l1", 2)]);
});

describe("the heading and the actions (FR-R3 AC1, FR-R4 AC1, AC6 release gating)", () => {
  it("asks the question of each partner type and offers the capacity action of its type to managers only", async () => {
    let html = await render();
    expect(html).toContain(">Which employers need workers I can recruit?</h1>");
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile#availability-heading"[^>]*>Update workforce capacity/);
    html = await render({ type: "staffing_company" });
    expect(html).toContain(">Which employers need the workforce I can provide?</h1>");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/workforce-profile#availability-heading"[^>]*>Add workforce/);
    html = await render({ role: "member" });
    expect(html).not.toContain("Update workforce capacity");
  });

  it("shows no block or action of a feature that is not released: job orders, invitations, submissions, messages", async () => {
    const html = await render();
    for (const absent of [/job order/i, /invitation/i, /submission/i, /unread/i, /Find employers/i, /Respond to request/i, /Find companies/i]) {
      expect(html).not.toMatch(absent);
    }
  });

  it("links the job order marketplace to every member while release 2b is on (V40)", async () => {
    releasedMock.mockImplementation(async (name: string) => name === "release_job_orders");
    try {
      for (const role of ["owner", "member"] as const) {
        expect(await render({ role })).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/job-orders"[^>]*>Job orders<\/a>/);
      }
    } finally {
      releasedMock.mockImplementation(async () => false);
    }
  });
});

describe("the review and listing state (FR-J1 AC11, FR-J4 AC7, AC10, NFR-C7)", () => {
  it("shows a submitted partner that it is waiting for review, never as approved or verified", async () => {
    for (const status of ["pending_review", "re_review"]) {
      reviewMock.mockResolvedValue({ status, submittedAt: "2026-11-21T10:00:00Z", infoStep: null, listedAt: null });
      const html = await render({ role: "member" });
      expect(html).toContain(">Your company is waiting for review</h2>");
      expect(html).toContain("A review usually takes one working day.");
      expect(html).toContain("The licences you declare");
      expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>See your workforce profile/);
      expect(html).not.toMatch(/approved|verified/i);
    }
  });

  it("shows the message of our team, the statement of reasons and the listing, never approved", async () => {
    reviewMock.mockResolvedValue({ status: "info_requested", submittedAt: null, infoStep: "where_you_serve", listedAt: null });
    outcomeMock.mockResolvedValue({ decision: "request_info", reason: "Please add the countries you source from.", infoStep: "where_you_serve", decidedAt: "2026-11-22T10:00:00Z" });
    let html = await render();
    expect(html).toContain("Check where you serve and what you offer, then submit your company again.");
    expect(html).toContain(">Message from our team</h3>");
    expect(html).toContain("Please add the countries you source from.");
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding"[^>]*>Review and submit again/);
    expect(html, "no follower count before the company is listed").not.toContain("Followers:");
    expect(await render({ role: "member" }), "a member does not resubmit").not.toContain("Review and submit again");

    reviewMock.mockResolvedValue({ status: "declined", submittedAt: null, infoStep: null, listedAt: null });
    outcomeMock.mockResolvedValue({ decision: "decline", reason: "The registry has no entry for this number.", infoStep: null, decidedAt: "2026-11-22T10:00:00Z" });
    html = await render();
    expect(html).toContain(">Your company is not listed</h2>");
    expect(html).toContain(">Reason</h3>");
    // NFR-C7: the same redress route as the decline email.
    expect(html).toMatch(/<a[^>]*href="\/en\/legal\/complaints-and-dispute-process"[^>]*>How to appeal this decision/);

    reviewMock.mockResolvedValue({ status: "listed", submittedAt: null, infoStep: null, listedAt: "2026-11-22T10:00:00Z" });
    outcomeMock.mockResolvedValue({ decision: "approve", reason: null, infoStep: null, decidedAt: "2026-11-22T10:00:00Z" });
    html = await render();
    expect(html).toContain(">Your company is listed</h2>");
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>Complete your workforce profile/);
    expect(html).not.toMatch(/approved|verified/i);
    // FR-L4 AC11: a listed company reads its follower count, never who follows it.
    expect(html).toContain("Followers: fewer than 5");
    expect(html).toMatch(/<a[^>]*href="\/en\/following"[^>]*>Companies you follow/);
    expect(followersMock).toHaveBeenCalledWith("org-9");

    reviewMock.mockResolvedValue({ status: "re_review", submittedAt: "2026-11-23T10:00:00Z", infoStep: null, listedAt: "2026-11-22T10:00:00Z" });
    html = await render();
    expect(html).toContain("Your company stays listed while our team reviews the change.");
    expect(html).toContain("Followers: fewer than 5");
  });

  it("states the listing, the missing part of the profile and a profile hidden by moderation", async () => {
    figuresMock.mockResolvedValue(figures({ listed: false, profileMissing: "serves_market" }));
    let html = await render();
    expect(html).toContain("Not listed yet");
    expect(html).toContain("Missing the countries you serve");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>Add the countries you serve to complete your workforce profile/);
    figuresMock.mockResolvedValue(figures({ profileHidden: true }));
    html = await render();
    expect(html).toContain("Hidden from the partner directories by our team");
  });
});

describe("profile views (FR-R3 AC7, AC10, FR-R4 AC9)", () => {
  it("shows a small count as fewer than 5, a count from 5 as the number, no view as guidance and no count outside the plan", async () => {
    figuresMock.mockResolvedValue(figures({ profileViews: null, profileViewsFewerThan: 5 }));
    expect(await render()).toMatch(/<dt[^>]*>Profile views in the last 30 days<\/dt><dd[^>]*><span[^>]*>fewer than 5</);
    figuresMock.mockResolvedValue(figures({ profileViews: 12 }));
    expect(await render()).toMatch(/Profile views in the last 30 days<\/dt><dd[^>]*><span[^>]*>12</);
    figuresMock.mockResolvedValue(figures({ profileViews: 0 }));
    const empty = await render();
    expect(empty).toContain("Views appear here once employers open your profile.");
    expect(empty).not.toContain("Profile views in the last 30 days");
    figuresMock.mockResolvedValue(figures({ profileViews: null, profileViewsInPlan: false }));
    const free = await render();
    expect(free).toContain("Your plan does not include profile view counts.");
    expect(free).toMatch(/href="\/en\/org\/manila-skills\/billing"[^>]*>Compare plans/);
    expect(await render({ role: "member" })).not.toContain("Compare plans");
  });
});

describe("licences", () => {
  it("shows the current count, the next expiry, expiring and expired licences in words, and guidance without any", async () => {
    figuresMock.mockResolvedValue(figures({ licencesCurrent: 2, licencesExpiring: 1, licencesExpired: 1, nextLicenceExpiry: "2026-11-05" }));
    let html = await render();
    expect(html).toMatch(/Current licences<\/dt><dd[^>]*>2</);
    expect(html).toContain("5 November 2026");
    expect(html).toContain("1 licence expires soon");
    expect(html).toContain("1 licence has expired");
    expect(html).toContain("Renew 1 expired licence");
    figuresMock.mockResolvedValue(figures({ licencesCurrent: 0, nextLicenceExpiry: null }));
    html = await render();
    expect(html).toContain("No licences recorded yet.");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/workforce-profile#licences-heading"[^>]*>Add a licence/);
  });
});

describe("available workforce (FR-R3 AC7, AC8, FR-R4 AC5, AC7)", () => {
  it("lists every listing with its confirmation, warns in words on a stale one and offers Confirm to managers only", async () => {
    listingsMock.mockResolvedValue([listing("l61", 61), listing("l59", 59), listing("l2", 2)]);
    let html = await render();
    expect(html.match(/<li class="grid gap-2 rounded-xl/g)).toHaveLength(3);
    expect(html.match(/Not confirmed for 60 days or more/g)).toHaveLength(1);
    expect(html).toContain("Confirmed 61 days ago, on");
    expect(html).toContain("Confirmed 2 days ago, on");
    expect(html.match(/>Confirm<span class="sr-only"> the listing for Welders and flame cutters from Philippines/g)).toHaveLength(2);
    html = await render({ role: "member" });
    expect(html).toContain("Not confirmed for 60 days or more");
    expect(html).not.toContain(">Confirm<span");
  });

  it("guides an empty company to add its workforce", async () => {
    listingsMock.mockResolvedValue([]);
    let html = await render({ type: "staffing_company" });
    expect(html).toContain("Add the workers you can supply, by country and occupation.");
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile#availability-heading"[^>]*>Add workforce/);
    html = await render({ role: "member" });
    expect(html).toContain("Your owner or an administrator lists the workers your company can supply");
  });
});

describe("the team (FR-J1 AC11)", () => {
  it("offers Invite your team to the owner and admins, and the team to a member", async () => {
    for (const role of ["owner", "admin"] as const) {
      const html = await render({ role });
      expect(html).toMatch(/<h2 id="team-heading"[^>]*>Your team<\/h2>/);
      expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/members"[^>]*>Invite your team/);
    }
    const html = await render({ role: "member", aal: "aal1" });
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/members"[^>]*>See your team/);
    expect(html).not.toContain("Invite your team");
  });
});

describe("plan and usage (FR-R3 AC9, FR-R4 AC8)", () => {
  it("shows the plan, its free month, the usage against the limits and Manage plan to managers only", async () => {
    let html = await render({ type: "staffing_company" });
    expect(html).toContain("Partner");
    expect(html).toContain("Free month ends");
    expect(html).toContain("20 November 2026");
    expect(html).toContain("2 of 3 countries served");
    expect(html).toContain("7 workforce listings (no limit)");
    expect(html, "the members limit of the partner plans (V81)").toContain("1 of 3 team members");
    expect(html).toMatch(/href="\/en\/org\/manila-skills\/billing"[^>]*>Manage plan/);
    html = await render({ role: "member", aal: "aal1" });
    expect(html).toContain("2 of 3 countries served");
    expect(html).not.toContain("Manage plan");
  });

  it("asks an owner or admin at aal1 for the code before the plan, as the billing page does", async () => {
    for (const role of ["owner", "admin"] as const) {
      const html = await render({ role, aal: "aal1" });
      expect(html).not.toContain("countries served");
      expect(html).toContain("/en/mfa?next=%2Fen%2Fdashboard%2Frecruitment%3Forg%3Dmanila-skills");
    }
    expect(planMock).not.toHaveBeenCalled();
    twoStepMock.mockResolvedValue(false);
    expect(await render({ aal: "aal1" })).toContain("once two-step verification is set up");
  });
});

describe("loading and partial failure (FR-R3 AC11, FR-R4 AC10)", () => {
  it("shows an error with Try again in place of a failed part and keeps the others", async () => {
    figuresMock.mockRejectedValue(new Error("down"));
    let html = await render();
    expect(html).toContain("The figures of your company could not be loaded");
    expect(html).toContain("Try again");
    expect(html).toContain("Your company is listed");
    expect(html).toContain("2 of 3 countries served");
    figuresMock.mockResolvedValue(figures());
    listingsMock.mockRejectedValue(new Error("down"));
    html = await render();
    expect(html).toContain("The available workforce could not be loaded");
    expect(html).toContain("Next actions");
    listingsMock.mockResolvedValue([listing("l1", 2)]);
    reviewMock.mockRejectedValue(new Error("down"));
    followersMock.mockClear();
    html = await render();
    expect(html.match(/could not be loaded/g), "a failed review read is reported once").toHaveLength(1);
    expect(html).toContain("The review state could not be loaded");
    expect(followersMock).not.toHaveBeenCalled();
  });
});
