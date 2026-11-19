import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const membersMock = vi.hoisted(() => vi.fn());
const invitationsMock = vi.hoisted(() => vi.fn());
const allowanceMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, roleRank: { member: 1, admin: 2, owner: 3 } }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/team", () => ({
  getMembers: membersMock,
  getInvitations: invitationsMock,
  getAllowance: allowanceMock,
  getPendingTransfer: async () => null,
}));
vi.mock("@/lib/actions/team", () => ({
  inviteMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  transferOwnership: vi.fn(),
  cancelOwnershipTransfer: vi.fn(),
  acceptOwnershipTransfer: vi.fn(),
}));

const { default: MembersPage } = await import("@/app/[lang]/(app)/org/[slug]/members/page");

const owner = { userId: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11", name: "Rita", email: "rita@example.test", role: "owner", mfaEnrolled: true };

function access(type: string, role = "owner") {
  return {
    user: { id: owner.userId },
    organization: { id: "org-1", slug: "manila", displayName: "Manila Skills", type, role, suspended: false },
  };
}

async function render(): Promise<string> {
  const page = await MembersPage({
    params: Promise.resolve({ lang: "en", slug: "manila" }),
    searchParams: Promise.resolve({}),
  });
  const { prelude } = await prerender(page);
  return new Response(prelude).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  membersMock.mockResolvedValue({ members: [owner], nextCursor: null });
  invitationsMock.mockResolvedValue([]);
  allowanceMock.mockResolvedValue({ limit: 5, used: 1 });
});

describe("the team page of a recruitment or staffing company (FR-J1 AC9)", () => {
  it.each(["recruitment_company", "staffing_company"])("opens to a %s while release 2a is on, with the invitation", async (type) => {
    requireOrgRoleMock.mockResolvedValue(access(type));
    const html = await render();
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila", "member", { partner: "either" });
    expect(releasedMock).toHaveBeenCalledWith("release_partner_directories");
    expect(html).toContain(">Team</h1>");
    expect(html).toContain("You are the only member");
    expect(html).toContain("Invite colleagues to keep your workforce profile, listings and licences up to date with you.");
    expect(html).toContain("Invite member");
  });

  it("is not found for a partner while release 2a is off, before any team data is read", async () => {
    releasedMock.mockResolvedValue(false);
    requireOrgRoleMock.mockResolvedValue(access("recruitment_company"));
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(membersMock).not.toHaveBeenCalled();
  });

  it("keeps the employer page as it was and reads no release switch", async () => {
    releasedMock.mockResolvedValue(false);
    requireOrgRoleMock.mockResolvedValue(access("employer"));
    const html = await render();
    expect(html).toContain("Invite colleagues to work on vacancies and applicants with you.");
    expect(releasedMock).not.toHaveBeenCalled();
  });

  it("shows a member of a partner the team without invitations or the allowance", async () => {
    requireOrgRoleMock.mockResolvedValue(access("staffing_company", "member"));
    membersMock.mockResolvedValue({
      members: [owner, { ...owner, userId: "7f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d12", name: "Ben", role: "member" }],
      nextCursor: null,
    });
    const html = await render();
    expect(html).toContain("Rita");
    expect(html).not.toContain("Invite member");
    expect(allowanceMock).not.toHaveBeenCalled();
    expect(invitationsMock).not.toHaveBeenCalled();
  });
});
