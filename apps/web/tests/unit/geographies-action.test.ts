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

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const input = { sourcesFrom: ["ph", "NP", "PH"], servesMarket: ["DE", "ae"] };
const refusal = (message: string, details: string) => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: ORG_ID, type: "recruitment_company", role: "owner" } });
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
      p_org: ORG_ID,
      p_sources_from: ["PH", "NP"],
      p_serves_market: ["DE", "AE"],
    });
  });

  it("stays on the workforce profile page and confirms the save", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "licence_required_destinations" ? { data: [], error: null } : { data: { changed: true }, error: null },
    );
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: false })).resolves.toEqual({
      saved: true,
      licencePrompts: [],
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("FR-K1 AC8: answers the served countries that need a licence the company does not hold", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "licence_required_destinations"
        ? { data: [{ country_code: "SA" }], error: null }
        : { data: { changed: true }, error: null },
    );
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: false })).resolves.toEqual({
      saved: true,
      licencePrompts: ["SA"],
    });
    expect(rpcMock).toHaveBeenCalledWith("licence_required_destinations", { p_org: ORG_ID });
  });

  it("FR-K1 AC8: asks nothing about licences while the direct-hiring rules are not enforced, and a failed read only drops the prompt", async () => {
    releasedMock.mockImplementation(async (name: string) => name === "release_partner_directories");
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: false })).resolves.toEqual({
      saved: true,
      licencePrompts: [],
    });
    expect(rpcMock).not.toHaveBeenCalledWith("licence_required_destinations", expect.anything());
    releasedMock.mockResolvedValue(true);
    rpcMock.mockImplementation(async (name: string) =>
      name === "licence_required_destinations"
        ? { data: null, error: { message: "boom", details: "", code: "XX000" } }
        : { data: { changed: true }, error: null },
    );
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: false })).resolves.toEqual({
      saved: true,
      licencePrompts: [],
    });
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

  it("names the plan limit next to the served countries when the database refuses one more and reports the prompt (AC5)", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_LIMIT_REACHED", "markets")).mockResolvedValueOnce({ data: null, error: null });
    await expect(saveOrganizationGeographies("manila-skills", input, { onboarding: true })).resolves.toEqual({
      errors: { servesMarket: "Your plan's limit of countries served is reached." },
    });
    expect(rpcMock).toHaveBeenLastCalledWith("record_limit_prompt", { p_org: ORG_ID, p_limit_key: "markets" });
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
