import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkFigures, PartnerFigures } from "@/lib/dashboard/partner-dashboard";
import type { ReviewOutcome } from "@/lib/dal/partner-review";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";
import type { CommitmentBlock } from "@/lib/validation/commitment";
import type { MemberRole } from "@/lib/validation/team";

const figuresMock = vi.hoisted(() => vi.fn());
const reviewMock = vi.hoisted(() => vi.fn());
const outcomeMock = vi.hoisted(() => vi.fn<() => Promise<ReviewOutcome | null>>(async () => null));
const followersMock = vi.hoisted(() => vi.fn(async () => ({ fewerThan: 5 })));
const planMock = vi.hoisted(() => vi.fn());
const usageMock = vi.hoisted(() => vi.fn());
const listingsMock = vi.hoisted(() => vi.fn<() => Promise<WorkforceListing[]>>(async () => []));
const twoStepMock = vi.hoisted(() => vi.fn(async () => true));
const commitmentMock = vi.hoisted(() => vi.fn<() => Promise<CommitmentBlock | null>>(async () => null));
const releasedMock = vi.hoisted(() => vi.fn<(name: string) => Promise<boolean>>(async () => false));
const unreadMock = vi.hoisted(() => vi.fn(async () => [{ conversationId: "c1", organizationId: "org-9", unread: 3 }]));

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
vi.mock("@/lib/dal/messaging", () => ({ getUnreadMessageCounts: unreadMock }));
vi.mock("@/lib/dal/commitment", () => ({ getCommitmentBlock: commitmentMock }));
vi.mock("@/lib/actions/commitment", () => ({ acceptCommitment: vi.fn(), acceptUpdatedCommitment: vi.fn() }));
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
  network: null,
  submissionStages: null,
  requests: null,
  matchingWorkers: null,
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
  languageCode: null,
  languageLevel: null,
  minExperienceYears: null,
  certificates: null,
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
  commitmentMock.mockResolvedValue(null);
});

describe("the heading and the actions (FR-R3 AC1, FR-R4 AC1, AC6 release gating)", () => {
  it("asks the question of each partner type under the company and its kind, without repeating the sidebar links", async () => {
    let html = await render();
    expect(html).toContain(">Which employers need workers I can recruit?</h1>");
    expect(html).toContain("Recruitment company</p>");
    html = await render({ type: "staffing_company" });
    expect(html).toContain(">Which employers need the workforce I can provide?</h1>");
    expect(html).toContain("Staffing company</p>");
    releasedMock.mockImplementation(async () => true);
    try {
      html = await render();
      expect(html).not.toContain('aria-label="Quick actions"');
      expect(html).not.toMatch(/>Find job orders<|>Find employers<|>Submit candidates<|>Company profile</);
    } finally {
      releasedMock.mockImplementation(async () => false);
    }
  });

  it("shows no block or action of a feature that is not released: job orders, invitations, submissions, messages", async () => {
    const html = await render();
    for (const absent of [/job order/i, /invitation/i, /submission/i, /unread/i, /Find employers/i, /Respond to request/i, /Find companies/i]) {
      expect(html).not.toMatch(absent);
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
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>Update your workforce profile/);
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
    expect(html.match(/>Confirm<span class="sr-only normal-case"> the listing for Welders and flame cutters from Philippines/g)).toHaveLength(2);
    html = await render({ role: "member" });
    expect(html).toContain("Not confirmed for 60 days or more");
    expect(html).not.toContain(">Confirm<span");
  });

  it("guides an empty company to add its workforce", async () => {
    listingsMock.mockResolvedValue([]);
    let html = await render({ type: "staffing_company" });
    expect(html).toContain("Add the workers you can supply, by country and occupation.");
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile#availability-heading"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Add workforce/);
    html = await render({ role: "member", type: "staffing_company" });
    expect(html).toContain("Your owner or an administrator lists the workers your company can supply");
  });

  it("calls a recruitment company's listings its recruiting capacity", async () => {
    listingsMock.mockResolvedValue([]);
    const html = await render({ type: "recruitment_company" });
    expect(html).toMatch(/<h2 id="workforce-heading"[^>]*>Recruiting capacity<\/h2>/);
    expect(html).toContain("No recruiting capacity listed yet");
    expect(html).toContain("Add how many candidates you can put forward and recruit each month, by country and occupation.");
    expect(html).not.toContain("Add the workers you can supply");
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

describe("an employer-pays commitment not accepted in its current version (FR-J3 AC4, FR-S4 AC7, V52)", () => {
  const block = (outdated: boolean): CommitmentBlock => ({
    outdated,
    title: "Employer-pays commitment",
    version: 2,
    changeSummary: "Fees for travel are named.",
    publishedAt: "2026-11-10T00:00:00Z",
    isDraft: false,
  });

  it("gives the owner the dialog with what changed, and tells an admin and a member that the owner must accept", async () => {
    releasedMock.mockImplementation(async (name) => name === "release_job_orders");
    commitmentMock.mockResolvedValue(block(true));
    let html = await render();
    expect(commitmentMock).toHaveBeenCalledWith("org-9");
    expect(html).toMatch(/role="status"[^>]*><[^>]*>.*<p id="commitment-reason"[^>]*>The employer-pays commitment has changed\. Accept the updated version/);
    expect(html).toMatch(/<dialog[^>]*>.*The employer-pays commitment has changed.*What changed:.*Fees for travel are named\./);
    for (const role of ["admin", "member"] as const) {
      html = await render({ role });
      expect(html).toContain("Your owner needs to accept the updated commitment before you can respond to job orders or submit candidates.");
      expect(html).not.toContain("What changed:");
      expect(html).not.toContain("Review and accept");
    }
  });

  it("says nothing while the commitment is current, and nothing about job orders while release 2b is off", async () => {
    releasedMock.mockImplementation(async (name) => name === "release_job_orders");
    expect(await render()).not.toContain("commitment");
    releasedMock.mockResolvedValue(false);
    commitmentMock.mockResolvedValue(block(true));
    expect(await render()).not.toContain("updated commitment");
    expect(commitmentMock).toHaveBeenCalledTimes(1);
  });

  it("leads the next action of a missing commitment to the reason on the workforce profile", async () => {
    figuresMock.mockResolvedValue(figures({ profileMissing: "employer_pays_commitment" }));
    expect(await render()).toMatch(
      /<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile#commitment-reason"[^>]*>Add the employer-pays commitment to complete your workforce profile/,
    );
  });
});

const network = (over: Partial<NetworkFigures> = {}): NetworkFigures => ({
  fittingJobOrders: 4,
  matchingEmployers: 3,
  invitationsAwaiting: 2,
  responsesOpen: 1,
  responsesShortlisted: 0,
  responsesSelected: 2,
  responsesDeclined: 1,
  ...over,
});
const noStages = {
  awaiting_candidate: 0,
  declined_by_candidate: 0,
  expired: 0,
  submitted: 0,
  viewed: 0,
  shortlisted: 0,
  interview: 0,
  offer: 0,
  hired: 0,
  rejected: 0,
  withdrawn: 0,
};

// A number of the activity row: the link to its page, the number, then its label.
const tile = (href: string, count: string, label: string) =>
  new RegExp(`<a[^>]*href="${href.replaceAll("/", "\\/")}"[^>]*><span[^>]*>${count}<\\/span> <span[^>]*>${label}<\\/span>`);

describe("the blocks of release 2b (FR-R3 AC4 to AC7, AC9, FR-R4 AC3, AC6 to AC9, FR-O5 AC10)", () => {
  it("shows the activity as numbers that open the pages of the sidebar", async () => {
    figuresMock.mockResolvedValue(figures({ network: network(), submissionStages: { ...noStages, awaiting_candidate: 2, interview: 1, hired: 1 } }));
    let html = await render();
    expect(html).toContain(">Your activity</h2>");
    expect(html).toMatch(tile("/en/org/manila-skills/job-orders", "4", "Fitting job orders"));
    expect(html).toContain("From 3 employers");
    expect(html).toMatch(tile("/en/org/manila-skills/invitations", "2", "Invitations waiting"));
    expect(html).toMatch(tile("/en/org/manila-skills/responses", "4", "Responses"));
    expect(html).toContain("0 shortlisted, 2 selected");
    expect(html).toMatch(tile("/en/org/manila-skills/submissions", "4", "Candidates submitted"));
    expect(html).toContain("1 hired");
    expect(html, "no card repeats a page of the sidebar").not.toMatch(/Answer the invitation|See your responses|See the job orders/);
    html = await render({ type: "staffing_company" });
    expect(html).toMatch(tile("/en/org/manila-skills/job-orders", "4", "Workforce requests"));
  });

  it("shows a zero as a zero, and no activity while job orders are not released", async () => {
    figuresMock.mockResolvedValue(figures({ network: network({ fittingJobOrders: 0, matchingEmployers: 0, invitationsAwaiting: 0 }) }));
    let html = await render();
    expect(html).toMatch(tile("/en/org/manila-skills/job-orders", "0", "Fitting job orders"));
    expect(html).not.toContain("From 0 employers");
    figuresMock.mockResolvedValue(figures({}));
    html = await render();
    expect(html).not.toContain("Your activity");
  });

  it("adds the monthly responses and submissions to the plan while released, and says a free plan pauses them (FR-R3 AC9)", async () => {
    releasedMock.mockImplementation(async () => true);
    try {
      await render();
      expect(usageMock).toHaveBeenCalledWith("org-9", [
        "markets",
        "listed_occupations",
        "workforce_listings",
        "members",
        "job_order_responses_per_month",
        "candidate_submissions_per_month",
      ]);
      planMock.mockResolvedValue({
        planName: "Free",
        status: "free",
        trialEndsAt: null,
        currentPeriodEnd: null,
        pastDueSince: null,
        subscriptionEnded: true,
      });
      const html = await render();
      expect(html).toContain("Free plan: responses and submissions are paused.");
      expect(html).toMatch(/href="\/en\/org\/manila-skills\/billing"[^>]*>Choose a plan/);
    } finally {
      releasedMock.mockImplementation(async () => false);
    }
    await render();
    expect(usageMock).toHaveBeenLastCalledWith("org-9", ["markets", "listed_occupations", "workforce_listings", "members"]);
  });
});

describe("the blocks of release 2c (FR-R3 AC6, AC11, FR-R4 AC6, V75)", () => {
  const release2c = async (name: string) => name === "release_messaging" || name === "release_find_workers";

  it("adds the partner requests, the unread messages and the matching workers only while their releases are on", async () => {
    expect(await render()).not.toMatch(/Partner requests|Unread messages|Matching workers/);
    expect(unreadMock).not.toHaveBeenCalled();
    figuresMock.mockResolvedValue(figures({ requests: { total: 3, inquiries: 2 }, matchingWorkers: { kind: "count", count: 12 } }));
    releasedMock.mockImplementation(release2c);
    try {
      const html = await render();
      expect(html).toMatch(tile("/en/org/manila-skills/messages\\?context=inquiry", "3", "Partner requests waiting"));
      expect(html).toMatch(tile("/en/org/manila-skills/messages", "3", "Unread messages"));
      expect(html).toMatch(tile("/en/org/manila-skills/find-workers", "12", "Matching workers"));
    } finally {
      releasedMock.mockImplementation(async () => false);
    }
  });

  it("asks an owner at aal1 for the two-step check instead of reading the company's messages", async () => {
    releasedMock.mockImplementation(release2c);
    try {
      const html = await render({ aal: "aal1" });
      expect(unreadMock).not.toHaveBeenCalled();
      expect(html).toMatch(/href="\/en\/mfa\?next=[^"]*"[^>]*><span[^>]*>–<\/span> <span[^>]*>Unread messages<\/span><span[^>]*> Complete the two-step check/);
    } finally {
      releasedMock.mockImplementation(async () => false);
    }
  });

  it("keeps the other numbers when the unread messages fail (FR-R3 AC11)", async () => {
    figuresMock.mockResolvedValue(figures({ requests: { total: 1, inquiries: 1 } }));
    releasedMock.mockImplementation(release2c);
    unreadMock.mockRejectedValueOnce(new Error("down"));
    try {
      const html = await render();
      expect(html).not.toContain(">Unread messages<");
      expect(html).toMatch(tile("/en/org/manila-skills/messages\\?context=inquiry", "1", "Partner requests waiting"));
    } finally {
      releasedMock.mockImplementation(async () => false);
    }
  });
});
