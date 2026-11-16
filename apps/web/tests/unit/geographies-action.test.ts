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

const { saveOrganizationGeographies } = await import("@/lib/actions/geographies");

const input = { sourcesFrom: ["ph", "NP", "PH"], servesMarket: ["DE", "ae"] };
const refusal = (message: string, details: string) => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", type: "recruitment_company", role: "owner" } });
  rpcMock.mockResolvedValue({ data: { changed: true }, error: null });
});

describe("saveOrganizationGeographies (FR-K1)", () => {
  it("checks an owner or admin of a partner at aal1, sends the merged codes and continues onboarding", async () => {
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: true })).rejects.toThrow(
      "REDIRECT:/en/onboarding",
    );
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", {
      mfa: false,
      hideFromOutsiders: true,
      partner: true,
    });
    expect(rpcMock).toHaveBeenCalledWith("set_organization_geographies", {
      p_org: "org-1",
      p_sources_from: ["PH", "NP"],
      p_serves_market: ["DE", "AE"],
    });
  });

  it("stays on the workforce profile page and confirms the save", async () => {
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: false })).resolves.toEqual({ saved: true });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sends nothing while release 2a is off, for a bad address or without a served country", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: true })).resolves.toEqual({
      message: expect.stringContaining("not open"),
    });
    releasedMock.mockResolvedValue(true);
    await expect(saveOrganizationGeographies("../x", input, { onboarding: true })).resolves.toEqual({ message: expect.any(String) });
    await expect(
      saveOrganizationGeographies("manila-skills", { ...input, servesMarket: [] }, { onboarding: true }),
    ).resolves.toEqual({ errors: { servesMarket: "Choose at least one country you recruit for" } });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the plan limit next to the served countries when the database refuses one more (AC5)", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_LIMIT_REACHED", "markets")).mockResolvedValueOnce({ data: 3, error: null });
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: true })).resolves.toEqual({
      errors: { servesMarket: "Your plan includes 3 countries served." },
    });
    expect(rpcMock).toHaveBeenLastCalledWith("organization_markets_limit", { p_org: "org-1" });
  });

  it.each([
    ["CHARA_INVALID_INPUT", "country_code", "Choose countries from the list."],
    ["CHARA_FORBIDDEN", "organization_suspended", "This organization is suspended, so its countries cannot be changed."],
    ["CHARA_FORBIDDEN", "release_off", "Registration for recruitment and staffing companies is not open at the moment."],
  ])("explains the refusal %s %s", async (message, details, text) => {
    rpcMock.mockResolvedValue(refusal(message, details));
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: true })).resolves.toEqual({ message: text });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("gives a generic message for anything else, keeping the form as it is", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", ""));
    const result = await saveOrganizationGeographies("manila-skills", input, { onboarding: true });
    expect(result).toEqual({ message: expect.any(String) });
    expect(result?.errors).toBeUndefined();
    consoleError.mockRestore();
  });
});
