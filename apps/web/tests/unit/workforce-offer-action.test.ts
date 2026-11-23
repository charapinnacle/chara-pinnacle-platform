import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkforceOfferInput } from "@/lib/validation/workforce-offer";

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

const { saveWorkforceOffer } = await import("@/lib/actions/workforce-offer");

const input: WorkforceOfferInput = {
  occupations: ["7212", "7126", "7212"],
  industries: ["c", "F"],
  languages: ["en", "TL", "ar"],
  recruitmentType: "international",
  staffingService: true,
  staffingTypes: ["temporary", "project"],
  sizeBand: "50_249",
  foundedYear: "2019",
};
const refusal = (message: string, details: string) => ({ data: null, error: { message, details, code: "P0001" } });
const partner = (type: string) => ({ organization: { id: "org-1", type, role: "owner" } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue(partner("recruitment_company"));
  rpcMock.mockResolvedValue({ data: { changed: true }, error: null });
});

describe("saveWorkforceOffer (FR-K2)", () => {
  it("checks an owner or admin of a partner at aal1, sends the merged codes and service types, and continues onboarding", async () => {
    await expect(saveWorkforceOffer("manila-skills", input, { onboarding: true })).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", {
      mfa: false,
      hideFromOutsiders: true,
      partner: true,
    });
    expect(rpcMock).toHaveBeenCalledWith("set_organization_workforce_offer", {
      p_org: "org-1",
      p_occupations: ["7212", "7126"],
      p_industries: ["C", "F"],
      p_languages: ["en", "tl", "ar"],
      p_recruitment_type: "international",
      p_service_types: ["staffing", "temporary", "project"],
      p_workforce_size_band: "50_249",
      p_founded_year: 2019,
    });
  });

  it("stays on the workforce profile page and confirms the save, leaving out an empty size band and year", async () => {
    requireOrgRoleMock.mockResolvedValue(partner("staffing_company"));
    await expect(
      saveWorkforceOffer("manila-skills", { ...input, staffingService: false, sizeBand: "", foundedYear: "" }, { onboarding: false }),
    ).resolves.toEqual({ saved: true });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith(
      "set_organization_workforce_offer",
      expect.objectContaining({ p_service_types: ["temporary", "project"], p_workforce_size_band: undefined, p_founded_year: undefined }),
    );
  });

  it("sends nothing while release 2a is off, for a bad address or without an occupation", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(saveWorkforceOffer("manila-skills", input, { onboarding: true })).resolves.toEqual({
      message: expect.stringContaining("not open"),
    });
    releasedMock.mockResolvedValue(true);
    await expect(saveWorkforceOffer("../x", input, { onboarding: true })).resolves.toEqual({ message: expect.any(String) });
    await expect(saveWorkforceOffer("manila-skills", { ...input, occupations: [] }, { onboarding: true })).resolves.toEqual({
      errors: { occupations: "Choose at least one occupation." },
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the plan limit next to the occupations when the database refuses one more (AC4, AC10)", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_LIMIT_REACHED", "listed_occupations"));
    await expect(saveWorkforceOffer("manila-skills", input, { onboarding: true })).resolves.toEqual({
      errors: { occupations: "Your plan's limit of occupations listed is reached." },
    });
  });

  it.each([
    ["occupation_id", "occupations", "Choose from the list."],
    ["industry_code", "industries", "Choose from the list."],
    ["language_code", "languages", "Choose from the list."],
    ["staffing_types", "staffingTypes", "Choose at least one staffing type."],
    ["staffing_service_required", "staffingTypes", "Tick that you also supply staff to choose staffing types."],
  ])("shows the refused value %s at its field (AC3, AC5)", async (details, field, text) => {
    rpcMock.mockResolvedValue(refusal("CHARA_INVALID_INPUT", details));
    await expect(saveWorkforceOffer("manila-skills", input, { onboarding: true })).resolves.toEqual({ errors: { [field]: text } });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each([
    ["organization_suspended", "This organisation is suspended, so its workforce offer cannot be changed."],
    ["release_off", "Registration for recruitment and staffing companies is not open at the moment."],
  ])("explains the refusal CHARA_FORBIDDEN %s", async (details, text) => {
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", details));
    await expect(saveWorkforceOffer("manila-skills", input, { onboarding: true })).resolves.toEqual({ message: text });
  });

  it("gives a generic message for anything else, keeping the form as it is (AC10)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", ""));
    const result = await saveWorkforceOffer("manila-skills", input, { onboarding: true });
    expect(result).toEqual({ message: expect.any(String) });
    expect(result?.errors).toBeUndefined();
    consoleError.mockRestore();
  });
});
