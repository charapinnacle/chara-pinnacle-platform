import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { submitForReview } = await import("@/lib/actions/partner-review");

const refusal = (message: string, details: string) => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", type: "recruitment_company", role: "admin" } });
  rpcMock.mockResolvedValue({ data: { review_status: "pending_review", changed: true }, error: null });
});

describe("submitForReview (FR-J1 AC10)", () => {
  it("checks the owner or an admin of a partner, submits and shows the pending state", async () => {
    await expect(submitForReview("manila-skills")).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", {
      mfa: false,
      hideFromOutsiders: true,
      partner: true,
    });
    expect(rpcMock).toHaveBeenCalledWith("submit_partner_for_review", { p_org: "org-1" });
  });

  it("sends nothing while release 2a is off or for a bad address", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(submitForReview("manila-skills")).resolves.toEqual({ message: expect.stringContaining("not open") });
    releasedMock.mockResolvedValue(true);
    await expect(submitForReview("../x")).resolves.toEqual({ message: expect.any(String) });
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["sources_from", "Choose at least one country you source workers from, then submit again."],
    ["employer_pays_commitment", "The owner needs to accept the current employer-pays commitment, then submit again."],
    ["staffing_types", "Choose at least one staffing type, then submit again."],
  ])("says what to complete for the missing field %s and stays on Ready", async (field, text) => {
    rpcMock.mockResolvedValue(refusal("CHARA_PROFILE_INCOMPLETE", field));
    await expect(submitForReview("manila-skills")).resolves.toEqual({ message: text });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sends a session at aal1 to enter its code and back to Ready", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "aal2_required"));
    await expect(submitForReview("manila-skills")).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/onboarding?step=ready")}`,
    );
  });

  it("explains a suspended organisation and shows the state as it is after a staff decision", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "organization_suspended"));
    await expect(submitForReview("manila-skills")).resolves.toEqual({
      message: "This organization is suspended, so it cannot be submitted for review.",
    });
    rpcMock.mockResolvedValue(refusal("CHARA_INVALID_TRANSITION", "listed"));
    await expect(submitForReview("manila-skills")).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("gives a generic message for anything else", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", ""));
    await expect(submitForReview("manila-skills")).resolves.toEqual({ message: expect.any(String) });
    rpcMock.mockResolvedValue(refusal("CHARA_PROFILE_INCOMPLETE", "something_new"));
    await expect(submitForReview("manila-skills")).resolves.toEqual({ message: expect.any(String) });
    expect(redirectMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
