import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const userMock = vi.hoisted(() => vi.fn());
const proofMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/dal/rate-limit", () => ({ visitorProof: proofMock }));

const { getPartnerProfile, getPartnerProfilePreview } = await import("@/lib/dal/partner-profile");

const row = {
  slug: "manila-skills",
  display_name: "Manila Skills",
  organization_type: "recruitment_company",
  based_in_country: "PH",
  based_in_country_name: "Philippines",
  served_countries: [],
  source_countries: [],
  industries: [],
  occupations: [],
  languages: [],
  service_types: [],
  recruitment_type: null,
  workforce_size_band: null,
  founded_year: null,
  description: null,
  website: null,
  commitment_current: false,
  workforce_profile_updated_at: null,
  listings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  proofMock.mockResolvedValue({ key: "k".repeat(64), proof: "p".repeat(64) });
  userMock.mockResolvedValue(null);
});

describe("getPartnerProfile (FR-K4 AC3, AC9)", () => {
  it("counts a visitor with the key and proof of the web tier for the action partner_profile", async () => {
    rpcMock.mockResolvedValue({ data: [{ ...row, viewer_is_member: false }], error: null });
    const result = await getPartnerProfile("manila-skills");
    expect(proofMock).toHaveBeenCalledWith("partner_profile");
    expect(rpcMock).toHaveBeenCalledWith("get_partner_profile", { p_slug: "manila-skills", p_key: "k".repeat(64), p_proof: "p".repeat(64) });
    expect(result).toMatchObject({ state: "found", viewerIsMember: false, profile: { displayName: "Manila Skills" } });
  });

  it("sends no visitor key for a signed-in reader, whom the database counts", async () => {
    userMock.mockResolvedValue({ id: "u1" });
    rpcMock.mockResolvedValue({ data: [{ ...row, viewer_is_member: true }], error: null });
    const result = await getPartnerProfile("manila-skills-2");
    expect(proofMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("get_partner_profile", { p_slug: "manila-skills-2", p_key: undefined, p_proof: undefined });
    expect(result).toMatchObject({ state: "found", viewerIsMember: true });
  });

  it("answers not_found for CHARA_NOT_FOUND and rate_limited for CHARA_RATE_LIMITED", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "CHARA_NOT_FOUND" } });
    expect(await getPartnerProfile("nope")).toEqual({ state: "not_found" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "CHARA_RATE_LIMITED", details: "30" } });
    expect(await getPartnerProfile("busy")).toEqual({ state: "rate_limited" });
  });

  it("throws on any other failure, so the page shows its error and never not found", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(getPartnerProfile("slow")).rejects.toThrow("The partner profile could not be loaded");
  });
});

describe("getPartnerProfilePreview (FR-K4 AC2)", () => {
  it("reads the member preview with whether the profile is public", async () => {
    rpcMock.mockResolvedValue({ data: [{ ...row, is_public: false }], error: null });
    expect(await getPartnerProfilePreview("org-1")).toMatchObject({ isPublic: false, profile: { slug: "manila-skills" } });
    expect(rpcMock).toHaveBeenCalledWith("preview_partner_profile", { p_org: "org-1" });
  });

  it("throws when the preview is refused", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "CHARA_FORBIDDEN" } });
    await expect(getPartnerProfilePreview("org-1")).rejects.toThrow("The profile preview could not be loaded");
  });
});
