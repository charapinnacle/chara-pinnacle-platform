import { beforeEach, describe, expect, it, vi } from "vitest";

const userMock = vi.hoisted(() => vi.fn());
const organizationsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/dal/reference", () => ({ getCountries: async () => [] }));
vi.mock("@/lib/dal/release", () => ({ isReleased: async () => true }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: organizationsMock }));

const { getContactEmployer } = await import("@/lib/dal/connection-actions");

const EMPLOYER = "22222222-2222-4222-8222-222222222222";

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
