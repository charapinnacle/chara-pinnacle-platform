import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployerNetwork, NetworkRequirement, RequirementFigures } from "@/lib/dashboard/employer-network";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

const { getEmployerNetwork } = await import("@/lib/dal/employer-network");
const { employerStageLines, firstWaiting, invitationAnswerLines, invitedPartnersText, requirementAction } =
  await import("@/lib/dashboard/employer-network");
const blocks = await import("@/components/dashboard/employer-network-blocks");

const requirement = (over: Partial<NetworkRequirement> = {}): NetworkRequirement => ({
  id: "q1",
  title: "Welders for Hamburg",
  status: "open",
  closesOn: "2027-07-01",
  responses: 2,
  selected: 1,
  awaitingDecision: 0,
  updatedUnseen: 0,
  invitationsWaiting: 0,
  ...over,
});

const figures = (over: Partial<RequirementFigures> = {}): RequirementFigures => ({
  open: 1,
  paused: 0,
  drafts: 0,
  listed: [requirement()],
  invitedPartners: 3,
  invitedRecruitment: 2,
  invitedStaffing: 1,
  invitationsWaiting: 1,
  invitationsAccepted: 0,
  invitationsResponded: 2,
  invitationsDeclined: 0,
  responsesWaiting: 0,
  responsesUpdated: 0,
  responsesShortlisted: 0,
  selectedPartners: 1,
  ...over,
});

const html = async (element: React.ReactElement) => {
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
};

const place = { lang: "en", slug: "acme" };

beforeEach(() => vi.clearAllMocks());

describe("getEmployerNetwork (FR-R5 AC3, AC4, AC7)", () => {
  const row = {
    saved_partners: 3,
    followed_companies: 1,
    open_requirements: 2,
    paused_requirements: 0,
    draft_requirements: 1,
    requirements: [
      {
        id: "q1",
        title: "Welders for Hamburg",
        status: "open",
        closes_on: null,
        responses: 2,
        selected: 1,
        awaiting_decision: 1,
        updated_unseen: 1,
        invitations_waiting: 0,
      },
    ],
    invited_partners: 3,
    invited_recruitment: 2,
    invited_staffing: 1,
    invitations_waiting: 1,
    invitations_accepted: 0,
    invitations_responded: 2,
    invitations_declined: 0,
    responses_waiting: 1,
    responses_updated: 1,
    responses_shortlisted: 0,
    selected_partners: 1,
    submission_stages: {
      submitted: 2,
      viewed: 1,
      shortlisted: 0,
      interview: 0,
      offer: 0,
      hired: 0,
      rejected: 0,
      withdrawn: 0,
    },
  };

  it("reads the one row of the organisation and maps it", async () => {
    rpcMock.mockResolvedValue({ data: [row], error: null });
    const network = await getEmployerNetwork("org-a");
    expect(rpcMock).toHaveBeenCalledWith("get_employer_network_dashboard", {
      p_org: "org-a",
    });
    expect(network.savedPartners).toBe(3);
    expect(network.requirements?.listed[0]).toEqual({
      id: "q1",
      title: "Welders for Hamburg",
      status: "open",
      closesOn: null,
      responses: 2,
      selected: 1,
      awaitingDecision: 1,
      updatedUnseen: 1,
      invitationsWaiting: 0,
    });
    expect(network.requirements?.invitedRecruitment).toBe(2);
    expect(network.submissionStages?.submitted).toBe(2);
  });

  it("keeps a switched-off release as null, never as zero", async () => {
    const off = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, key.endsWith("companies") || key === "saved_partners" ? value : null]),
    );
    rpcMock.mockResolvedValue({ data: [off], error: null });
    const network: EmployerNetwork = await getEmployerNetwork("org-a");
    expect(network).toEqual({
      savedPartners: 3,
      followedCompanies: 1,
      requirements: null,
      submissionStages: null,
    });
  });

  it("throws on a refusal so the block shows its error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "CHARA_FORBIDDEN" },
    });
    await expect(getEmployerNetwork("org-b")).rejects.toThrow("The partner network figures could not be loaded");
  });
});

describe("next actions and texts (NFR-U4)", () => {
  it("asks for a decision first, then invitations, then the responses", () => {
    expect(requirementAction(requirement({ awaitingDecision: 2 }))).toEqual({
      kind: "decide",
      text: "Decide on 2 responses",
    });
    expect(requirementAction(requirement({ responses: 0 }))).toEqual({
      kind: "invite",
      text: "Invite partners",
    });
    expect(requirementAction(requirement({ responses: 0, invitationsWaiting: 1 })).kind).toBe("responses");
    expect(requirementAction(requirement()).kind).toBe("responses");
  });

  it("reviews an unopened update before other waiting responses", () => {
    const a = requirement({ id: "a", awaitingDecision: 1 });
    const b = requirement({ id: "b", awaitingDecision: 1, updatedUnseen: 1 });
    expect(firstWaiting([a, b])?.id).toBe("b");
    expect(firstWaiting([a])?.id).toBe("a");
    expect(firstWaiting([requirement()])).toBeNull();
  });

  it("names the invited partners by type and the answers above 0 (FR-R5 AC4)", () => {
    expect(invitedPartnersText(figures())).toBe("3 partners: 2 recruitment, 1 staffing");
    expect(
      invitedPartnersText(
        figures({
          invitedPartners: 1,
          invitedRecruitment: 1,
          invitedStaffing: 0,
        }),
      ),
    ).toBe("1 partner: 1 recruitment");
    expect(invitationAnswerLines(figures())).toEqual([
      { label: "Waiting for the partner's answer", count: 1 },
      { label: "Responded", count: 2 },
    ]);
  });

  it("lists the pipeline stages that hold a candidate, new ones as not opened yet", () => {
    expect(
      employerStageLines({
        submitted: 2,
        viewed: 0,
        shortlisted: 1,
        interview: 0,
        offer: 0,
        hired: 1,
        rejected: 0,
        withdrawn: 0,
      }),
    ).toEqual([
      { stage: "submitted", label: "New, not opened yet", count: 2 },
      { stage: "shortlisted", label: "Shortlisted", count: 1 },
      { stage: "hired", label: "Hired", count: 1 },
    ]);
  });
});

describe("the blocks (FR-R5 AC3, AC8, AC9, AC10)", () => {
  it("lists each requirement with its state, a named response count and its next action", async () => {
    const out = await html(
      blocks.RequirementsCard({
        ...place,
        canManage: true,
        figures: figures({
          listed: [requirement({ awaitingDecision: 1, updatedUnseen: 1 })],
        }),
      }),
    );
    expect(out).toContain("Welders for Hamburg");
    expect(out).toMatch(/Status: <\/span>Open/);
    expect(out).toContain(">Updated<");
    expect(out).toMatch(/2 responses<span class="sr-only"> to Welders for Hamburg<\/span>/);
    expect(out).toMatch(
      /href="\/en\/org\/acme\/requirements\/q1\/responses"[^>]*>Decide on 1 response<span class="sr-only"> for Welders for Hamburg/,
    );
    expect(out).toContain("See your requirements");
  });

  it("asks a manager to post a requirement and tells a member who does (AC8, AC9)", async () => {
    const empty = figures({
      open: 0,
      listed: [],
      invitedPartners: 0,
      selectedPartners: 0,
    });
    let out = await html(blocks.RequirementsCard({ ...place, canManage: true, figures: empty }));
    expect(out).toContain("Post a workforce requirement to ask partners for a group of workers, for example 20 welders for Germany.");
    expect(out).toMatch(/href="\/en\/org\/acme\/requirements\/new"[^>]*>Post workforce requirement/);
    out = await html(blocks.RequirementsCard({ ...place, canManage: false, figures: empty }));
    expect(out).not.toContain("Post workforce requirement");
    expect(out).toContain("An owner or admin of your company posts workforce requirements");
    out = await html(
      blocks.RequirementsCard({
        ...place,
        canManage: true,
        figures: { ...empty, drafts: 2 },
      }),
    );
    expect(out).toContain("2 drafts are not published yet.");
    expect(out).toContain(">Publish a draft<");
  });

  it("shows the partners invited and selected, or how to invite them (AC4, AC9)", async () => {
    let out = await html(
      blocks.PartnersCard({
        figures: figures(),
        findPartnersHref: "/en/partners/recruitment",
      }),
    );
    expect(out).toContain("3 partners: 2 recruitment, 1 staffing");
    expect(out).toContain("Selected partners");
    out = await html(
      blocks.PartnersCard({
        figures: figures({
          invitedPartners: 0,
          invitationsWaiting: 0,
          invitationsResponded: 0,
          selectedPartners: 0,
        }),
        findPartnersHref: "/en/partners/recruitment",
      }),
    );
    expect(out).toContain("Invite recruitment or staffing partners from a requirement.");
    expect(out).toMatch(/href="\/en\/partners\/recruitment"[^>]*>Find partners/);
    expect(out).not.toMatch(/>0</);
  });

  it("leads to the comparison of the requirement whose responses wait, with the Updated badge", async () => {
    const out = await html(
      blocks.ResponsesWaitingCard({
        ...place,
        figures: figures({
          responsesWaiting: 2,
          responsesUpdated: 1,
          listed: [requirement({ awaitingDecision: 2, updatedUnseen: 1 })],
        }),
      }),
    );
    expect(out).toContain("Updated since you last opened them");
    expect(out).toMatch(/href="\/en\/org\/acme\/requirements\/q1\/responses\/compare"[^>]*>Compare the responses to Welders for Hamburg/);
  });

  it("counts the submitted candidates by stage and leads to the new ones", async () => {
    const stages = {
      submitted: 2,
      viewed: 0,
      shortlisted: 1,
      interview: 0,
      offer: 0,
      hired: 0,
      rejected: 0,
      withdrawn: 0,
    };
    let out = await html(blocks.EmployerSubmissionsCard({ ...place, stages }));
    expect(out).toContain('aria-label="New, not opened yet: 2"');
    expect(out).toMatch(/href="\/en\/org\/acme\/applicants\?source=submissions&amp;stage=submitted"[^>]*>Review 2 new candidates/);
    out = await html(
      blocks.EmployerSubmissionsCard({
        ...place,
        stages: { ...stages, submitted: 0, shortlisted: 0 },
      }),
    );
    expect(out).toContain("No candidates submitted yet.");
  });

  it("shows saved partners as a figure, or how to save one (AC9)", async () => {
    let out = await html(
      blocks.SavedPartnersCard({
        ...place,
        count: 3,
        findPartnersHref: "/en/partners/recruitment",
      }),
    );
    expect(out).toContain('aria-label="Saved partners: 3"');
    out = await html(
      blocks.SavedPartnersCard({
        ...place,
        count: 0,
        findPartnersHref: "/en/partners/recruitment",
      }),
    );
    expect(out).toContain("Save partners from their profile to find them here.");
    out = await html(
      blocks.FollowedCompaniesCard({
        lang: "en",
        count: 0,
        findPartnersHref: "/en/partners/recruitment",
      }),
    );
    expect(out).toContain("Follow partners and companies from their page");
  });
});
