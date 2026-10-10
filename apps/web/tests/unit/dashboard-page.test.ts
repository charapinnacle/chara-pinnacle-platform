import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@/lib/validation/team";

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
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock, requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: organizationsMock }));
vi.mock("@/lib/dal/mfa", () => ({ hasVerifiedTotpFactor: twoStepMock }));
const firstStepsMock = vi.hoisted(() => vi.fn());
const passportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dal/documents", () => ({ getDocumentReminders: vi.fn(async () => []), hasUsableCv: vi.fn(async () => false) }));
vi.mock("@/lib/dal/passport", () => ({ getPassport: passportMock }));
vi.mock("@/lib/dal/dashboard", () => ({ getFirstSteps: firstStepsMock }));
vi.mock("@/components/dashboard/worker-dashboard", () => ({
  WorkerDashboard: (props: { firstName: string; completeness: { percent: number } }) => `WORKER ${props.firstName} ${props.completeness.percent}`,
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
const render = async (kind = "employer", query?: Record<string, string>) => renderToStaticMarkup(await DashboardPage(props(kind, query)));
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
  it("sends a candidate without a passport to the onboarding and shows the others their dashboard with the completeness", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker", aal: "aal1" });
    passportMock.mockResolvedValue(null);
    await expect(render("worker")).rejects.toThrow("REDIRECT:/en/onboarding");
    passportMock.mockResolvedValue({
      firstName: "Ana",
      headline: null,
      occupationId: null,
      yearsExperience: null,
      availability: null,
      skills: [],
      languages: [],
      authorizations: [],
    });
    expect(await render("worker")).toBe("WORKER Ana 10");
  });
});
