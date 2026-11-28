import { beforeEach, describe, expect, it, vi } from "vitest";

const userMock = vi.hoisted(() => vi.fn());
const organizationsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/dal/reference", () => ({ getCountries: async () => [] }));
vi.mock("@/lib/dal/release", () => ({ isReleased: async () => true }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: organizationsMock }));

const { getContactEmployer, getContactPartner } = await import("@/lib/dal/connection-actions");

const EMPLOYER = "22222222-2222-4222-8222-222222222222";
const RECRUITER = "33333333-3333-4333-8333-333333333333";
const STAFFING = "44444444-4444-4444-8444-444444444444";
const TARGET = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  userMock.mockResolvedValue({ id: "u1", suspended: false, accountKind: "company" });
  organizationsMock.mockResolvedValue([
    { id: EMPLOYER, slug: "acme", displayName: "Acme Bau", type: "employer", role: "owner", suspended: false, basedInCountry: "AT" },
  ]);
});

describe("getContactEmployer (FR-P2 AC3, AC9)", () => {
  it("gives the employer's country, which Request workforce starts with", async () => {
    expect(await getContactEmployer(EMPLOYER)).toEqual({
      id: EMPLOYER,
      slug: "acme",
      displayName: "Acme Bau",
      manager: true,
      basedInCountry: "AT",
    });
  });
});

describe("getContactPartner (D91)", () => {
  const staffing = { id: STAFFING, slug: "staffit", displayName: "Staffit", type: "staffing_company", role: "member", suspended: false, basedInCountry: "DE" };
  const recruiter = { id: RECRUITER, slug: "rekrut", displayName: "Rekrut", type: "recruitment_company", role: "admin", suspended: false, basedInCountry: "DE" };

  it("picks the viewer's first partner company that may write to the target's type", async () => {
    organizationsMock.mockResolvedValue([staffing, recruiter]);
    expect(await getContactPartner({ id: TARGET, type: "recruitment_company" })).toEqual({
      id: STAFFING,
      slug: "staffit",
      displayName: "Staffit",
      manager: false,
    });
    expect(await getContactPartner({ id: TARGET, type: "staffing_company" })).toEqual({
      id: RECRUITER,
      slug: "rekrut",
      displayName: "Rekrut",
      manager: true,
    });
  });

  it("offers nothing for staffing to staffing, a member of the target, a suspended company or a worker", async () => {
    organizationsMock.mockResolvedValue([staffing]);
    expect(await getContactPartner({ id: TARGET, type: "staffing_company" })).toBeNull();
    organizationsMock.mockResolvedValue([recruiter, { ...staffing, id: TARGET }]);
    expect(await getContactPartner({ id: TARGET, type: "staffing_company" })).toBeNull();
    organizationsMock.mockResolvedValue([{ ...recruiter, suspended: true }]);
    expect(await getContactPartner({ id: TARGET, type: "recruitment_company" })).toBeNull();
    userMock.mockResolvedValue({ id: "u1", suspended: false, accountKind: "worker" });
    organizationsMock.mockResolvedValue([recruiter]);
    expect(await getContactPartner({ id: TARGET, type: "recruitment_company" })).toBeNull();
  });

  it("offers nothing to an employer's members, who send through getContactEmployer", async () => {
    expect(await getContactPartner({ id: TARGET, type: "recruitment_company" })).toBeNull();
  });
});
