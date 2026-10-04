import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const limitMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = { limit: limitMock };
    for (const method of ["select", "eq", "is", "order"]) chain[method] = () => chain;
    return { rpc: rpcMock, from: () => chain };
  },
}));

const { getAllowance, getInvitationPreview, getInvitations, getMembers } = await import("@/lib/dal/team");

const MEMBERS_PAGE_SIZE = 50;

function row(index: number) {
  return {
    user_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    display_name: index === 1 ? "Mia" : null,
    email: null,
    role: index === 1 ? "owner" : "member",
    mfa_enrolled: null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getMembers", () => {
  it("asks for one row more than a page, passes the cursor and gives no next page for a short list", async () => {
    rpcMock.mockResolvedValue({ data: [row(1), row(2)], error: null });
    const page = await getMembers("org-1", "00000000-0000-4000-8000-000000000000");
    expect(rpcMock).toHaveBeenCalledWith("list_organization_members", {
      p_org: "org-1",
      p_limit: MEMBERS_PAGE_SIZE + 1,
      p_after_user: "00000000-0000-4000-8000-000000000000",
    });
    expect(page.nextCursor).toBeNull();
    expect(page.members.map((member) => [member.name, member.email, member.role])).toEqual([
      ["Mia", null, "owner"],
      [null, null, "member"],
    ]);
  });

  it("cuts the extra row and points the cursor at the last row of the page", async () => {
    const rows = Array.from({ length: MEMBERS_PAGE_SIZE + 1 }, (_, index) => row(index + 1));
    rpcMock.mockResolvedValue({ data: rows, error: null });
    const page = await getMembers("org-1", null);
    expect(page.members).toHaveLength(MEMBERS_PAGE_SIZE);
    expect(page.nextCursor).toBe(rows[MEMBERS_PAGE_SIZE - 1].user_id);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_after_user: undefined });
  });

  it("fails when the list cannot be loaded", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN" } });
    await expect(getMembers("org-1", null)).rejects.toThrow("The team could not be loaded");
  });
});

describe("getInvitations", () => {
  it("is bounded and marks an invitation past its expiry as expired", async () => {
    limitMock.mockResolvedValue({
      data: [
        { id: "a", email: "a@example.test", role: "member", expires_at: "2000-01-01T00:00:00Z" },
        { id: "b", email: "b@example.test", role: "admin", expires_at: "2999-01-01T00:00:00Z" },
      ],
      error: null,
    });
    const invitations = await getInvitations("org-1");
    expect(limitMock).toHaveBeenCalledWith(50);
    expect(invitations.map((invitation) => [invitation.email, invitation.expired])).toEqual([
      ["a@example.test", true],
      ["b@example.test", false],
    ]);
  });
});

describe("getAllowance and getInvitationPreview", () => {
  it("reads a missing limit as null", async () => {
    rpcMock.mockResolvedValue({ data: [{ member_limit: null, used: 3 }], error: null });
    await expect(getAllowance("org-1")).resolves.toEqual({ limit: null, used: 3 });
  });

  it("returns null for a link that shows nothing and the details for one that does", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await expect(getInvitationPreview("t")).resolves.toBeNull();
    rpcMock.mockResolvedValue({
      data: [{ organization_name: "Acme", role: "member", email: "bea@example.test", expires_at: "2026-10-12T00:00:00Z" }],
      error: null,
    });
    await expect(getInvitationPreview("t")).resolves.toEqual({
      organizationName: "Acme",
      role: "member",
      email: "bea@example.test",
      expiresAt: "2026-10-12T00:00:00Z",
    });
  });
});
