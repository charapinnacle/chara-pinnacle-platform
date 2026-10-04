import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const revalidateMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const allowanceMock = vi.hoisted(() => vi.fn());
const forgetMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.fn();
const singleMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, requireUser: requireUserMock }));
vi.mock("@/lib/dal/team", () => ({ getAllowance: allowanceMock }));
vi.mock("@/lib/invitation-cookie", () => ({ forgetInvitation: forgetMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = { single: singleMock };
    for (const method of ["select", "eq", "is"]) chain[method] = () => chain;
    return { rpc: rpcMock, from: () => chain };
  },
}));

const {
  acceptInvitation,
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  changeMemberRole,
  inviteMember,
  removeMember,
  transferOwnership,
} = await import("@/lib/actions/team");

const orgId = "0a1b2c3d-0000-4000-8000-000000000001";
const userId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const token = "T".repeat(43);

function refusal(message: string, details: string | null = null) {
  return { data: null, error: { message, details, code: "P0001" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ user: { id: "u" }, organization: { id: orgId, slug: "acme", role: "owner" } });
  rpcMock.mockResolvedValue({ data: null, error: null });
  singleMock.mockResolvedValue({ data: { expires_at: "2026-10-12T10:00:00Z" }, error: null });
});

describe("inviteMember", () => {
  const input = { slug: "acme", email: " Bea@Example.com ", role: "member" as const };

  it("checks the role first, sends the normalised address and returns the link path once with its expiry", async () => {
    rpcMock.mockResolvedValue({ data: token, error: null });
    await expect(inviteMember(input)).resolves.toEqual({
      invitation: { path: `/en/invitations/${token}`, expiresAt: "2026-10-12T10:00:00Z" },
    });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "admin");
    expect(rpcMock).toHaveBeenCalledWith("invite_member", { p_org: orgId, p_email: "bea@example.com", p_role: "member" });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("does not reach the database for an invalid address or role", async () => {
    const result = await inviteMember({ ...input, email: "nope", role: "owner" as never });
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(["email", "role"]);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("answers a reached limit with the limit that applies, read back from the database", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_LIMIT_REACHED", "members"));
    allowanceMock.mockResolvedValue({ limit: 5, used: 5 });
    await expect(inviteMember(input)).resolves.toEqual({ limitReached: { limit: 5 } });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("still reports the limit when the allowance cannot be read", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_LIMIT_REACHED", "members"));
    allowanceMock.mockRejectedValue(new Error("down"));
    await expect(inviteMember(input)).resolves.toEqual({ limitReached: { limit: null } });
  });

  it.each([
    ["CHARA_RATE_LIMITED", null, { message: "You have sent many invitations in the last hour. Try again later." }],
    ["CHARA_CONFLICT", "already_a_member", { errors: { email: "This person is already a member of the team." } }],
    ["CHARA_INVALID_INPUT", "email", { errors: { email: "Enter a valid email address." } }],
  ])("explains %s without the database text", async (message, details, expected) => {
    rpcMock.mockResolvedValue(refusal(message, details));
    await expect(inviteMember(input)).resolves.toEqual(expected);
  });

  it("sends a person whose two-step verification has lapsed to the MFA page and back to the team", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "aal2_required"));
    await expect(inviteMember(input)).rejects.toThrow(`REDIRECT:/en/mfa?next=${encodeURIComponent("/en/org/acme/members")}`);
  });

  it("shows a generic message for any other error and logs only its code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "secret detail"));
    await expect(inviteMember(input)).resolves.toEqual({ message: "We could not complete this request. Try again." });
    expect(log).toHaveBeenCalledWith("Team action failed", { code: "P0001", message: "CHARA_FORBIDDEN" });
    log.mockRestore();
  });
});

describe("member management", () => {
  it("changes a role as an admin or owner", async () => {
    await expect(changeMemberRole({ slug: "acme", userId, role: "admin" })).resolves.toEqual({});
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "admin");
    expect(rpcMock).toHaveBeenCalledWith("change_member_role", { p_org: orgId, p_user: userId, p_role: "admin" });
  });

  it("refuses the owner role before the database is asked", async () => {
    await expect(changeMemberRole({ slug: "acme", userId, role: "owner" })).resolves.toMatchObject({ message: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("removes a member and explains that the owner cannot be removed", async () => {
    await expect(removeMember({ slug: "acme", userId })).resolves.toEqual({});
    expect(rpcMock).toHaveBeenCalledWith("remove_member", { p_org: orgId, p_user: userId });
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "cannot_remove_owner"));
    await expect(removeMember({ slug: "acme", userId })).resolves.toEqual({
      message: "The owner cannot be removed. Transfer ownership first.",
    });
  });

  it("starts and cancels a transfer as the owner only", async () => {
    await transferOwnership({ slug: "acme", userId });
    expect(requireOrgRoleMock).toHaveBeenLastCalledWith("en", "acme", "owner");
    expect(rpcMock).toHaveBeenLastCalledWith("transfer_ownership", { p_org: orgId, p_new_owner: userId });
    await cancelOwnershipTransfer("acme");
    expect(requireOrgRoleMock).toHaveBeenLastCalledWith("en", "acme", "owner");
    expect(rpcMock).toHaveBeenLastCalledWith("cancel_ownership_transfer", { p_org: orgId });
  });

  it("lets any member confirm a transfer, and sends one at aal1 to two-step verification", async () => {
    await acceptOwnershipTransfer("acme");
    expect(requireOrgRoleMock).toHaveBeenLastCalledWith("en", "acme", "member");
    expect(rpcMock).toHaveBeenLastCalledWith("accept_ownership_transfer", { p_org: orgId });
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "aal2_required"));
    await expect(acceptOwnershipTransfer("acme")).rejects.toThrow("REDIRECT:/en/mfa?next=");
  });

  it("says that no transfer is waiting for an expired, cancelled or foreign one", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_INVALID_INPUT", "no_pending_transfer"));
    await expect(acceptOwnershipTransfer("acme")).resolves.toEqual({
      message: "No ownership transfer is waiting. It may have expired or been cancelled.",
    });
  });
});

describe("acceptInvitation", () => {
  beforeEach(() => {
    rpcMock.mockResolvedValue({ data: orgId, error: null });
    singleMock.mockResolvedValue({ data: { slug: "acme" }, error: null });
  });

  it("accepts, forgets the remembered link and lands on the organization", async () => {
    await expect(acceptInvitation(token)).rejects.toThrow("REDIRECT:/en/org/acme");
    expect(requireUserMock).toHaveBeenCalledWith("en");
    expect(rpcMock).toHaveBeenCalledWith("accept_invitation", { p_token: token });
    expect(forgetMock).toHaveBeenCalled();
  });

  it("does not call the database for a token of the wrong shape", async () => {
    await expect(acceptInvitation("short")).resolves.toMatchObject({ message: expect.stringContaining("not valid") });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gives a candidate the employer-only message and keeps the link", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "workers_cannot_join_organizations"));
    await expect(acceptInvitation(token)).resolves.toEqual({
      message: "This invitation can only be accepted by an employer account. Use a different email address.",
    });
    expect(forgetMock).not.toHaveBeenCalled();
  });

  it("answers an expired, used, replaced or foreign invitation with one message that names no cause", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_INVITATION_INVALID"));
    const result = await acceptInvitation(token);
    expect(result?.message).toBe(
      "This invitation is not valid for your account. It may have expired, been replaced, or been sent to another email address.",
    );
  });
});
