import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployerNetwork } from "@/lib/dashboard/employer-network";
import type { MemberRole } from "@/lib/validation/team";

const networkMock = vi.hoisted(() => vi.fn<() => Promise<EmployerNetwork>>());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/dal/employer-network", () => ({
  getEmployerNetwork: networkMock,
}));
vi.mock("@/lib/dal/usage", () => ({
  getUsagePrompts: () => Promise.reject(new Error("usage")),
}));
vi.mock("@/lib/dal/dashboard", async () => {
  const { stageTotals } = await import("@/lib/dashboard/stage-counts");
  return {
    getFirstSteps: () => Promise.reject(new Error("steps")),
    startDashboardLoad: () => {
      const failed = () => {
        const promise = Promise.reject(new Error("phase 1"));
        void promise.catch(() => undefined);
        return promise;
      };
      return {
        applications: Promise.resolve({
          byStage: stageTotals([]),
          total: 0,
          recent: 0,
        }),
        vacancies: Promise.resolve({ open: 2, any: true }),
        plan: failed(),
        empty: Promise.resolve(false),
      };
    },
  };
});

const { EmployerDashboard } = await import("@/components/dashboard/employer-dashboard");

const network = (over: Partial<EmployerNetwork> = {}): EmployerNetwork => ({
  savedPartners: 0,
  followedCompanies: 0,
  requirements: {
    open: 0,
    paused: 0,
    drafts: 0,
    listed: [],
    invitedPartners: 0,
    invitedRecruitment: 0,
    invitedStaffing: 0,
    invitationsWaiting: 0,
    invitationsAccepted: 0,
    invitationsResponded: 0,
    invitationsDeclined: 0,
    responsesWaiting: 0,
    responsesUpdated: 0,
    responsesShortlisted: 0,
    selectedPartners: 0,
  },
  submissionStages: null,
  ...over,
});

const render = async ({ role = "admin" as MemberRole, released = true, requirements = true } = {}) => {
  const element = EmployerDashboard({
    lang: "en",
    organization: { id: "org-a", slug: "acme", displayName: "Acme", role },
    twoStepDone: true,
    network: released,
    requirements,
  });
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->|<!--\/?\$-->/g, "");
};

beforeEach(() => {
  vi.clearAllMocks();
  networkMock.mockResolvedValue(network());
});

describe("the partner network part of the employer dashboard (FR-R5)", () => {
  it("asks the question after the Phase 1 blocks, with Post workforce requirement and Find partners (AC1, AC2)", async () => {
    const html = await render();
    const question = html.indexOf(">Who can help me fill my workforce requirement?</h2>");
    expect(html.indexOf("lg:col-span-7")).toBeGreaterThan(0);
    expect(question).toBeGreaterThan(html.indexOf("lg:col-span-7"));
    expect(html).toContain('aria-label="Active jobs: 2"');
    expect(html).toMatch(/href="\/en\/org\/acme\/jobs\/new"[^>]*>Post job/);
    expect(html.slice(question)).toMatch(/href="\/en\/org\/acme\/requirements\/new"[^>]*>Post workforce requirement/);
    expect(html.slice(question)).toMatch(/href="\/en\/partners\/recruitment"[^>]*>Find partners/);
    expect(html).not.toMatch(/Find workers|unread/i);
  });

  it("gives a member the figures without Post job or Post workforce requirement (AC8)", async () => {
    const html = await render({ role: "member" });
    expect(html).toContain("Who can help me fill my workforce requirement?");
    expect(html).not.toContain("Post workforce requirement");
    expect(html).not.toContain("Post job");
    expect(html).toContain("Find partners");
  });

  it("shows the empty state of every block with no bare zero (AC9)", async () => {
    const html = await render({ role: "owner" });
    expect(html).toContain("Post a workforce requirement to ask partners for a group of workers, for example 20 welders for Germany.");
    expect(html).toContain("Invite recruitment or staffing partners from a requirement.");
    expect(html).toContain("Save partners from their profile to find them here.");
    expect(html.slice(html.indexOf('id="requirements-heading"'))).not.toMatch(/>0</);
  });

  it("keeps the 2b blocks out while job orders are off and the whole part out while release 2a is off (AC7)", async () => {
    networkMock.mockResolvedValue(network({ requirements: null, savedPartners: 2 }));
    let html = await render({ requirements: false });
    expect(html).toContain("Saved partners: 2");
    expect(html).not.toMatch(/Workforce requirements|Partners invited|Post workforce requirement|Responses waiting/);
    html = await render({ released: false });
    expect(html).not.toContain("Who can help me fill my workforce requirement?");
    expect(networkMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retry in place of the network blocks when their read fails (AC10)", async () => {
    networkMock.mockRejectedValue(new Error("down"));
    const html = await render();
    expect(html).toContain("The partner network figures could not be loaded");
    expect(html).toContain("Try again");
  });
});
