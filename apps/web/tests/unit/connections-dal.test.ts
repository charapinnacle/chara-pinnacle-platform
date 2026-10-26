import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const userMock = vi.hoisted(() => vi.fn());
const organizationsMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const logFaultMock = vi.hoisted(() => vi.fn(() => "ref-1"));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock, from: fromMock }) }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock, requireUser: requireUserMock }));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: organizationsMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/fault", () => ({ logFault: logFaultMock, faultMessage: (reference: string) => `Something went wrong (${reference})` }));

const dal = await import("@/lib/dal/connections");
const { setFollowing, setSavedPartner } = await import("@/lib/actions/connections");

const PARTNER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

// A select chain whose last call resolves to the rows of the table.
function table(rows: Record<string, unknown>[]) {
  const chain = { select: () => chain, eq: () => chain, in: () => Promise.resolve({ data: rows, error: null }) };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
});

describe("getConnectionStates (FR-L4 AC9)", () => {
  it("asks nothing for a visitor", async () => {
    userMock.mockResolvedValue(null);
    const states = await dal.getConnectionStates([{ id: PARTNER, type: "recruitment_company" }]);
    expect(states.access.get(PARTNER)).toEqual({ kind: "visitor" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("reads the saves of the saving employer and the viewer's own follows", async () => {
    userMock.mockResolvedValue({ id: "u-1", accountKind: "company", suspended: false });
    organizationsMock.mockResolvedValue([{ id: ORG, type: "employer", suspended: false }]);
    fromMock.mockImplementation((name: string) =>
      name === "follows" ? table([{ organization_id: PARTNER }]) : table([{ target_organization_id: PARTNER }]),
    );
    const states = await dal.getConnectionStates([{ id: PARTNER, type: "staffing_company" }]);
    expect(states.access.get(PARTNER)).toEqual({ kind: "signed_in", saveFor: ORG, follow: true });
    expect(states.saved.has(PARTNER)).toBe(true);
    expect(states.followed.has(PARTNER)).toBe(true);
    expect(fromMock.mock.calls.map(([name]) => name).sort()).toEqual(["follows", "saved_items"]);
  });
});

describe("the lists and the count (FR-L4 AC5, AC10)", () => {
  it("maps the saved partners with the total and the cursor", async () => {
    rpcMock.mockResolvedValue({
      data: [{ partner_id: PARTNER, slug: "gamma", display_name: "Gamma", organization_type: "staffing_company", based_in_country: "PH",
        based_in_country_name: "Philippines", served_countries: [{ code: "DE", name: "Germany" }], saved_at: "2026-12-01T10:00:00Z",
        total: 3, next_cursor: "c-1" }],
      error: null,
    });
    await expect(dal.listSavedPartners(ORG, null)).resolves.toEqual({
      partners: [{ id: PARTNER, slug: "gamma", displayName: "Gamma", organizationType: "staffing_company", basedIn: "Philippines",
        servedCountries: ["Germany"], savedAt: "2026-12-01T10:00:00Z" }],
      total: 3,
      nextCursor: "c-1",
    });
    expect(rpcMock).toHaveBeenCalledWith("list_saved_partners", { p_org: ORG, p_cursor: undefined, p_limit: 20 });
  });

  it("counts the followed companies from the first row and 0 for none", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await expect(dal.countFollowedCompanies()).resolves.toBe(0);
    expect(rpcMock).toHaveBeenCalledWith("list_followed_companies", { p_cursor: undefined, p_limit: 1 });
  });

  it("reads the follower count as a number or as fewer than the minimum", async () => {
    rpcMock.mockResolvedValue({ data: { count: 7 }, error: null });
    await expect(dal.getFollowerCount(ORG)).resolves.toEqual({ count: 7 });
    rpcMock.mockResolvedValue({ data: { count: null, fewer_than: 5 }, error: null });
    await expect(dal.getFollowerCount(ORG)).resolves.toEqual({ fewerThan: 5 });
    rpcMock.mockResolvedValue({ data: { count: null, fewer_than: 5, followers: ["u-1"] }, error: null });
    await expect(dal.getFollowerCount(ORG)).resolves.toEqual({ fewerThan: 5 });
  });

  it("throws for the route's error boundary when a list cannot be read", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(dal.listFollowedCompanies(null)).rejects.toThrow("The followed companies could not be loaded");
  });
});

describe("setSavedPartner and setFollowing (FR-L4 AC1, AC4, AC9)", () => {
  it("set the state rather than toggle it", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await expect(setSavedPartner(PARTNER, ORG, true)).resolves.toEqual({});
    expect(rpcMock).toHaveBeenCalledWith("toggle_saved_partner", { p_partner: PARTNER, p_org: ORG, p_saved: true });
    await expect(setFollowing(PARTNER, false)).resolves.toEqual({});
    expect(rpcMock).toHaveBeenCalledWith("toggle_follow", { p_org: PARTNER, p_following: false });
  });

  it("refuse malformed ids and a switched-off release without calling the database", async () => {
    await expect(setSavedPartner("nope", ORG, true)).resolves.toHaveProperty("message");
    releasedMock.mockResolvedValue(false);
    await expect(setFollowing(PARTNER, true)).resolves.toEqual({ message: "Saving and following are not available at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("say what the database refused", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_NOT_FOUND" } });
    await expect(setSavedPartner(PARTNER, ORG, true)).resolves.toEqual({ message: "This partner can no longer be saved." });
    await expect(setFollowing(PARTNER, true)).resolves.toEqual({ message: "This company can no longer be followed." });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "employer_follows_employer" } });
    await expect(setFollowing(PARTNER, true)).resolves.toEqual({ message: "Employers cannot follow other employers." });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: null } });
    await expect(setSavedPartner(PARTNER, ORG, true)).resolves.toEqual({ message: "Only members of an employer can save partners." });
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(setFollowing(PARTNER, true)).resolves.toEqual({ message: "Something went wrong (ref-1)" });
  });
});
