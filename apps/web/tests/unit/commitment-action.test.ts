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

const { acceptCommitment, acceptUpdatedCommitment } = await import("@/lib/actions/commitment");

const refusal = (message: string, details: string) => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", type: "recruitment_company", role: "owner" } });
  rpcMock.mockResolvedValue({ data: { version: 1, changed: true }, error: null });
});

describe("acceptCommitment (FR-J3)", () => {
  it("checks the owner of a partner at aal1, accepts the version shown and continues onboarding", async () => {
    await expect(acceptCommitment("manila-skills", 1, { confirmed: true })).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "owner", {
      mfa: false,
      hideFromOutsiders: true,
      partner: true,
    });
    expect(rpcMock).toHaveBeenCalledWith("accept_employer_pays_commitment", { p_org: "org-1", p_version: 1 });
  });

  it("refuses an unticked box at the box and sends nothing (AC1)", async () => {
    await expect(acceptCommitment("manila-skills", 1, { confirmed: false })).resolves.toEqual({
      errors: { confirmed: "Please confirm the commitment to continue" },
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends nothing while release 2a is off, for a bad address or a bad version", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(acceptCommitment("manila-skills", 1, { confirmed: true })).resolves.toEqual({
      message: expect.stringContaining("not open"),
    });
    releasedMock.mockResolvedValue(true);
    await expect(acceptCommitment("../x", 1, { confirmed: true })).resolves.toEqual({ message: expect.any(String) });
    await expect(acceptCommitment("manila-skills", -1, { confirmed: true })).resolves.toEqual({ message: expect.any(String) });
    await expect(acceptCommitment("manila-skills", 1.5, { confirmed: true })).resolves.toEqual({ message: expect.any(String) });
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["CHARA_INVALID_INPUT", "version", "The commitment has changed since this page was opened. Reload the page to read the current version."],
    ["CHARA_FORBIDDEN", "organization_suspended", "This organization is suspended, so the commitment cannot be accepted."],
    ["CHARA_FORBIDDEN", "release_off", "Registration for recruitment and staffing companies is not open at the moment."],
  ])("explains the refusal %s %s and stays on the step", async (message, details, text) => {
    rpcMock.mockResolvedValue(refusal(message, details));
    await expect(acceptCommitment("manila-skills", 1, { confirmed: true })).resolves.toEqual({ message: text });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("gives a generic message for anything else", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", ""));
    await expect(acceptCommitment("manila-skills", 1, { confirmed: true })).resolves.toEqual({ message: expect.any(String) });
    expect(redirectMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("acceptUpdatedCommitment (FR-J3 AC4, FR-S4 AC7)", () => {
  it("accepts the version the dialog showed for the owner and stays on the page", async () => {
    await expect(acceptUpdatedCommitment("manila-skills", 2, { confirmed: true })).resolves.toEqual({ accepted: true });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "owner", {
      mfa: false,
      hideFromOutsiders: true,
      partner: true,
    });
    expect(rpcMock).toHaveBeenCalledWith("accept_employer_pays_commitment", { p_org: "org-1", p_version: 2 });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("refuses an unticked box and a newer version like the onboarding step", async () => {
    await expect(acceptUpdatedCommitment("manila-skills", 2, { confirmed: false })).resolves.toEqual({
      errors: { confirmed: "Please confirm the commitment to continue" },
    });
    rpcMock.mockResolvedValue(refusal("CHARA_INVALID_INPUT", "version"));
    await expect(acceptUpdatedCommitment("manila-skills", 2, { confirmed: true })).resolves.toEqual({
      message: "The commitment has changed since this page was opened. Reload the page to read the current version.",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
