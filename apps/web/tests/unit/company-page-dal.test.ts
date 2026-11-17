import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const singleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const roleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
}));
const logFaultMock = vi.hoisted(() => vi.fn(() => "ref-1"));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: roleMock }));
vi.mock("@/lib/fault", () => ({ logFault: logFaultMock, faultMessage: (reference: string) => `Something went wrong (${reference})` }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: rpcMock,
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
  }),
}));

const { getCompanyPage, getCompanyPageEnabled } = await import("@/lib/dal/company-page");
const { setCompanyPageVisibility } = await import("@/lib/actions/company-page");

const row = {
  slug: "acme-bau",
  display_name: "Acme Bau",
  based_in_country: "DE",
  based_in_country_name: "Germany",
  industry_code: "F",
  industry_name: "Construction",
  website: null,
  description: null,
  open_vacancy_count: 0,
  vacancies: [],
  job_order_count: 0,
  job_orders: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  roleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme-bau" } });
});

describe("getCompanyPage (FR-K5 AC1, AC3, AC8)", () => {
  it("reads the page by its slug and tells the page what the viewer may do", async () => {
    rpcMock.mockResolvedValue({ data: [{ ...row, viewer_role: "admin" }], error: null });
    await expect(getCompanyPage("acme-bau")).resolves.toMatchObject({
      state: "found",
      viewer: "manager",
      partnerSlug: null,
      page: { displayName: "Acme Bau" },
    });
    expect(rpcMock).toHaveBeenCalledWith("get_company_page", { p_slug: "acme-bau" });
  });

  it("passes the viewer's own partner slug for the job order links (V54)", async () => {
    rpcMock.mockResolvedValue({ data: [{ ...row, viewer_role: null, viewer_partner_slug: "manila" }], error: null });
    await expect(getCompanyPage("acme-bau")).resolves.toMatchObject({ state: "found", viewer: "outsider", partnerSlug: "manila" });
  });

  it("answers not_found for every page that is not public, and when no row comes back", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0002", message: "CHARA_NOT_FOUND" } });
    await expect(getCompanyPage("off-company")).resolves.toEqual({ state: "not_found" });
    rpcMock.mockResolvedValue({ data: [], error: null });
    await expect(getCompanyPage("empty-company")).resolves.toEqual({ state: "not_found" });
  });

  it("throws on any other error, so the page shows its error boundary", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(getCompanyPage("slow-company")).rejects.toThrow("The company page could not be loaded");
  });
});

describe("getCompanyPageEnabled", () => {
  it("reads the switch of the organisation", async () => {
    singleMock.mockResolvedValue({ data: { public_page_enabled: true }, error: null });
    await expect(getCompanyPageEnabled("org-1")).resolves.toBe(true);
    singleMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(getCompanyPageEnabled("org-1")).rejects.toThrow("The company page setting could not be loaded");
  });
});

describe("setCompanyPageVisibility (FR-K5 AC2, AC9)", () => {
  it("turns the page on for the organisation of the slug and returns the address of the page", async () => {
    rpcMock.mockResolvedValue({ data: { enabled: true, slug: "acme-bau" }, error: null });
    await expect(setCompanyPageVisibility("acme-bau", true)).resolves.toEqual({ enabled: true, href: "/en/companies/acme-bau" });
    expect(roleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { hideFromOutsiders: true });
    expect(rpcMock).toHaveBeenCalledWith("set_company_page_visibility", { p_org: "org-1", p_enabled: true });
  });

  it("sends nothing for a bad slug or value, or while release 2a is off", async () => {
    await expect(setCompanyPageVisibility("Not a slug!", true)).resolves.toHaveProperty("message");
    await expect(setCompanyPageVisibility("acme-bau", "yes" as unknown as boolean)).resolves.toHaveProperty("message");
    releasedMock.mockResolvedValue(false);
    await expect(setCompanyPageVisibility("acme-bau", true)).resolves.toEqual({ message: "The company page cannot be changed at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends an aal1 session to two-step verification and explains a suspension", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "CHARA_FORBIDDEN", details: "aal2_required" } });
    await expect(setCompanyPageVisibility("acme-bau", true)).rejects.toThrow("redirect:/en/mfa?next=%2Fen%2Forg%2Facme-bau%2Fprofile");
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "CHARA_FORBIDDEN", details: "organization_suspended" } });
    await expect(setCompanyPageVisibility("acme-bau", false)).resolves.toEqual({
      message: "This organization is suspended, so its company page cannot be changed.",
    });
    expect(logFaultMock).not.toHaveBeenCalled();
  });

  it("logs any other error as a fault with a reference", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(setCompanyPageVisibility("acme-bau", false)).resolves.toEqual({ message: "Something went wrong (ref-1)" });
    expect(logFaultMock).toHaveBeenCalledWith("Company page change", expect.objectContaining({ message: "boom" }));
  });
});
