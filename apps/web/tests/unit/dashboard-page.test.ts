import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@/lib/validation/team";
import type { ReviewOutcome } from "@/lib/dal/partner-review";

const requireUserMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const organizationsMock = vi.hoisted(() => vi.fn());
const twoStepMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock, requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/organizations", () => ({
  getMyOrganizations: organizationsMock,
  getMyOrganization: async (id: string) => ((await organizationsMock(id)) as unknown[] | undefined)?.[0] ?? null,
}));
vi.mock("@/lib/dal/mfa", () => ({ hasVerifiedTotpFactor: twoStepMock }));
const reviewMock = vi.hoisted(() => vi.fn());
const outcomeMock = vi.hoisted(() => vi.fn<() => Promise<ReviewOutcome | null>>(async () => null));
const releasedMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dal/partner-review", () => ({
  getPartnerReview: reviewMock,
  getReviewOutcome: outcomeMock,
  getReviewTargetDays: async () => 1,
}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
const firstStepsMock = vi.hoisted(() => vi.fn());
const passportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dal/documents", () => ({ getDocumentReminders: vi.fn(async () => []), hasUsableCv: vi.fn(async () => false) }));
vi.mock("@/lib/dal/passport", () => ({ getPassport: passportMock }));
vi.mock("@/lib/dal/dashboard", () => ({ getFirstSteps: firstStepsMock }));
vi.mock("@/components/reports/report-outcomes", () => ({ ReportOutcomes: () => null }));
vi.mock("@/components/dashboard/worker-dashboard", () => ({
  WorkerDashboard: (props: { availability: string | null; availableFrom: string | null; completeness: { percent: number } }) =>
    `WORKER ${props.availability} ${props.availableFrom} ${props.completeness.percent}`,
}));
vi.mock("@/components/dashboard/employer-dashboard", () => ({
  EmployerDashboard: (props: { organization: { slug: string; role: string } }) =>
    `FIGURES ${props.organization.slug} ${props.organization.role}`,
}));

const { default: DashboardPage } = await import("@/app/[lang]/(app)/dashboard/[kind]/page");

const acme = { id: "org-a", slug: "acme-bau", displayName: "Acme Bau", role: "owner" as MemberRole };
const beta = { id: "org-b", slug: "beta-works", displayName: "Beta Works", role: "member" as MemberRole };
const props = (kind: string, query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ lang: "en", kind }), searchParams: Promise.resolve(query) }) as Parameters<typeof DashboardPage>[0];
// prerender waits for the async parts (Panel) as the server does; the comments it puts between text nodes are dropped.
const render = async (kind = "employer", query?: Record<string, string>) => {
  const { prelude } = await prerender(await DashboardPage(props(kind, query)));
  return (await new Response(prelude).text()).replace(/<!-- -->|<!--\/?\$-->/g, "");
};
const access = (over: Partial<typeof acme & { suspended: boolean }> = {}) => ({
  user: { id: "user-1" },
  organization: { ...acme, suspended: false, ...over },
});

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal2" });
  organizationsMock.mockResolvedValue([acme, beta]);
  twoStepMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue(access());
  firstStepsMock.mockResolvedValue({ vacancyPublished: false, teamInvited: false, planChosen: false });
});

describe("the access rules of the employer dashboard (FR-E5 AC9)", () => {
  it("sends a candidate to the candidate dashboard and an unknown kind to a page that does not exist", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker", aal: "aal1" });
    await expect(render("employer")).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    await expect(render("recruiter")).rejects.toThrow("NOT_FOUND");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("FR-J1: sends a recruitment or staffing company without an organisation, or still in onboarding, to its onboarding", async () => {
    releasedMock.mockResolvedValue(true);
    reviewMock.mockResolvedValue({ status: "onboarding", submittedAt: null, infoStep: null });
    for (const type of ["recruitment_company", "staffing_company"]) {
      requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1", intendedOrganizationType: type });
      organizationsMock.mockResolvedValue([]);
      await expect(render("employer")).rejects.toThrow("REDIRECT:/en/onboarding");
      organizationsMock.mockResolvedValue([{ id: "org-9", slug: "agency", displayName: "Agency", type, role: "owner", suspended: false }]);
      await expect(render("employer")).rejects.toThrow("REDIRECT:/en/onboarding");
    }
    expect(reviewMock).toHaveBeenCalledWith("org-9");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("FR-J1 AC11: shows a submitted partner that it is waiting for review, never as approved or verified", async () => {
    releasedMock.mockResolvedValue(true);
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1", intendedOrganizationType: "recruitment_company" });
    organizationsMock.mockResolvedValue([
      { id: "org-9", slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company", role: "member", suspended: false },
    ]);
    for (const status of ["pending_review", "re_review"]) {
      reviewMock.mockResolvedValue({ status, submittedAt: "2026-11-21T10:00:00Z", infoStep: null });
      const html = await render("employer");
      expect(html).toContain(">Your company is waiting for review</h2>");
      expect(html).toContain("A review usually takes one working day.");
      expect(html).toContain("Your company name and registration number");
      expect(html).toContain("The licences you declare");
      expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>Complete your workforce profile/);
      expect(html).not.toMatch(/approved|verified/i);
    }
    reviewMock.mockResolvedValue({ status: "info_requested", submittedAt: null, infoStep: "where_you_serve" });
    let html = await render("employer");
    expect(html).toContain(">Our team asked for more information</h2>");
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding"[^>]*>Review and submit again/);
    reviewMock.mockResolvedValue({ status: "listed", submittedAt: null, infoStep: null });
    html = await render("employer");
    expect(html).toContain(">Your company is listed</h2>");
    expect(html).not.toMatch(/approved|verified/i);
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("FR-J4 AC7, AC10, NFR-C7: shows the message of our team, the statement of reasons and the listing, never approved", async () => {
    releasedMock.mockResolvedValue(true);
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1", intendedOrganizationType: "recruitment_company" });
    organizationsMock.mockResolvedValue([
      { id: "org-9", slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company", role: "owner", suspended: false },
    ]);
    reviewMock.mockResolvedValue({ status: "info_requested", submittedAt: null, infoStep: "where_you_serve", listedAt: null });
    outcomeMock.mockResolvedValue({ decision: "request_info", reason: "Please add the countries you source from.", infoStep: "where_you_serve", decidedAt: "2026-11-22T10:00:00Z" });
    let html = await render("employer");
    expect(html).toContain("Check where you serve and what you offer, then submit your company again.");
    expect(html).toContain(">Message from our team</h3>");
    expect(html).toContain("Please add the countries you source from.");
    expect(outcomeMock).toHaveBeenCalledWith("org-9");

    reviewMock.mockResolvedValue({ status: "declined", submittedAt: null, infoStep: null, listedAt: null });
    outcomeMock.mockResolvedValue({ decision: "decline", reason: "The registry has no entry for this number.", infoStep: null, decidedAt: "2026-11-22T10:00:00Z" });
    html = await render("employer");
    expect(html).toContain(">Your company is not listed</h2>");
    expect(html).toContain(">Reason</h3>");
    expect(html).toContain("The registry has no entry for this number.");
    expect(html).toMatch(/<a[^>]*href="\/en\/contact"[^>]*>Contact us about this decision/);

    reviewMock.mockResolvedValue({ status: "listed", submittedAt: null, infoStep: null, listedAt: "2026-11-22T10:00:00Z" });
    outcomeMock.mockResolvedValue({ decision: "approve", reason: null, infoStep: null, decidedAt: "2026-11-22T10:00:00Z" });
    html = await render("employer");
    expect(html).toContain(">Your company is listed</h2>");
    expect(html).toMatch(/<a[^>]*href="\/en\/org\/manila-skills\/workforce-profile"[^>]*>Complete your workforce profile/);
    expect(html).not.toMatch(/approved|verified/i);

    reviewMock.mockResolvedValue({ status: "re_review", submittedAt: "2026-11-23T10:00:00Z", infoStep: null, listedAt: "2026-11-22T10:00:00Z" });
    html = await render("employer");
    expect(html).toContain("Your company stays listed while our team reviews the change.");
    expect(html).not.toContain("not shown to employers");
  });

  it("FR-J1: sends a submitted partner to its onboarding while release 2a is off", async () => {
    releasedMock.mockResolvedValue(false);
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1", intendedOrganizationType: "staffing_company" });
    organizationsMock.mockResolvedValue([
      { id: "org-9", slug: "agency", displayName: "Agency", type: "staffing_company", role: "owner", suspended: false },
    ]);
    await expect(render("employer")).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("FR-J1: keeps the employer dashboard for a partner account that belongs to an employer, so it never loops", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal2", intendedOrganizationType: "staffing_company" });
    organizationsMock.mockResolvedValue([{ id: "org-1", slug: "acme-bau", displayName: "Acme Bau", type: "employer", role: "owner", suspended: false }]);
    await render("employer").catch((error: unknown) => {
      expect(String(error)).not.toContain("REDIRECT:/en/onboarding");
    });
    expect(redirectMock).not.toHaveBeenCalledWith("/en/onboarding");
  });

  it("checks the membership of the organization in the address and hides it from outsiders", async () => {
    await render("employer", { org: "beta-works" });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "beta-works", "member", { mfa: false, hideFromOutsiders: true });
  });

  it("takes the first organization of the user when the address names none, and ignores a value that is not text", async () => {
    await render();
    expect(requireOrgRoleMock).toHaveBeenLastCalledWith("en", "acme-bau", "member", { mfa: false, hideFromOutsiders: true });
    await DashboardPage({
      params: Promise.resolve({ lang: "en", kind: "employer" }),
      searchParams: Promise.resolve({ org: ["a", "b"] }),
    } as Parameters<typeof DashboardPage>[0]);
    expect(requireOrgRoleMock).toHaveBeenLastCalledWith("en", "acme-bau", "member", { mfa: false, hideFromOutsiders: true });
  });

  it("lets the page of an unknown slug answer, whatever the user", async () => {
    requireOrgRoleMock.mockImplementation(() => {
      throw new Error("NOT_FOUND");
    });
    await expect(render("employer", { org: "a" })).rejects.toThrow("NOT_FOUND");
  });

  it("offers to set up the company when the user has none", async () => {
    organizationsMock.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Your company is not set up yet");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });
});

describe("what each role sees", () => {
  it("shows the figures to an owner at aal2 and to a member at aal1", async () => {
    expect(await render()).toContain("FIGURES acme-bau owner");
    requireUserMock.mockResolvedValue({ id: "user-2", accountKind: "company", aal: "aal1" });
    requireOrgRoleMock.mockResolvedValue(access({ slug: "beta-works", role: "member" }));
    expect(await render("employer", { org: "beta-works" })).toContain("FIGURES beta-works member");
  });

  it("holds an owner and an admin at aal1 to the guided steps and asks for the code when a device exists", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1" });
    for (const role of ["owner", "admin"] as const) {
      requireOrgRoleMock.mockResolvedValue(access({ role }));
      const html = await render();
      expect(html, role).not.toContain("FIGURES");
      expect(html, role).toContain("Set up two-step verification");
      expect(html, role).toContain("Enter your code");
      expect(html, role).toContain("/en/mfa?next=%2Fen%2Fdashboard%2Femployer%3Forg%3Dacme-bau");
    }
  });

  it("ticks the first steps at aal1 from the database: a done step is text, an open one is the link that does it", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1" });
    firstStepsMock.mockResolvedValue({ vacancyPublished: true, teamInvited: false, planChosen: true });
    const html = await render();
    expect(firstStepsMock).toHaveBeenCalledWith("org-a");
    expect(html).toContain("4 of 5 done");
    expect(html).toContain("Publish your first vacancy<span class=\"sr-only\"> (done)</span>");
    expect(html).toContain("Choose a plan<span class=\"sr-only\"> (done)</span>");
    expect(html).toMatch(/<a [^>]*href="\/en\/org\/acme-bau\/members"[^>]*>.*Invite a team member/);
    expect(html).not.toMatch(/href="\/en\/org\/acme-bau\/billing"/);
  });

  it("shows an error in place of the first steps at aal1 when they cannot be read, and keeps the rest of the page", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1" });
    firstStepsMock.mockRejectedValue(new Error("The first steps could not be loaded"));
    const html = await render();
    expect(html).toContain("The first steps could not be loaded");
    expect(html).toContain("Enter your code");
    expect(html).not.toContain("Get set up");
  });

  it("tells an owner at aal1 without a device to set one up, with no link to enter a code", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company", aal: "aal1" });
    twoStepMock.mockResolvedValue(false);
    const html = await render();
    expect(html).not.toContain("Enter your code");
    expect(html).toContain("once two-step verification is set up");
  });

  it("shows no figure of a suspended organization", async () => {
    requireOrgRoleMock.mockResolvedValue(access({ suspended: true }));
    const html = await render();
    expect(html).toContain("This organization is suspended, so its figures are not available.");
    expect(html).not.toContain("FIGURES");
  });

  it("does not list the other organizations of the user: the switcher of the header does", async () => {
    const html = await render();
    expect(html).not.toContain("beta-works");
    expect(html).not.toContain("You also belong to");
  });
});

describe("the candidate dashboard (UX-03)", () => {
  it("sends a candidate without a passport to the onboarding and shows the others their dashboard with the completeness and the availability", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker", aal: "aal1" });
    passportMock.mockResolvedValue(null);
    await expect(render("worker")).rejects.toThrow("REDIRECT:/en/onboarding");
    passportMock.mockResolvedValue({
      firstName: "Ana",
      headline: null,
      occupationId: null,
      yearsExperience: null,
      availability: "from_date",
      availableFrom: "2026-12-01",
      skills: [],
      languages: [],
      authorizations: [],
    });
    expect(await render("worker")).toBe("WORKER from_date 2026-12-01 20");
  });
});
