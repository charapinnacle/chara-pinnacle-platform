import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const userMock = vi.hoisted(() => vi.fn());
const organizationsMock = vi.hoisted(() => vi.fn());
const faultMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: organizationsMock }));
vi.mock("@/lib/fault", () => ({ logFault: faultMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock, from: fromMock }) }));

const { getInviteChoices, getSuggestionInvitations } = await import("@/lib/dal/invitations");
const { invitationSourceLabels } = await import("@/lib/invitations/presentation");

// A query builder that answers every chained call with itself and resolves to the result given.
function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "in", "eq", "order", "limit"]) builder[name] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

const P1 = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("the invite choices of a profile and the saved partners (FR-O1 AC12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userMock.mockResolvedValue({ id: "u1", suspended: false, accountKind: "company" });
    organizationsMock.mockResolvedValue([
      { id: "e1", slug: "first", displayName: "First GmbH", type: "employer", role: "owner", suspended: false },
      { id: "e2", slug: "second", displayName: "Second GmbH", type: "employer", role: "admin", suspended: false },
      { id: "e3", slug: "member-of", displayName: "Member GmbH", type: "employer", role: "member", suspended: false },
    ]);
  });

  it("offers every managed employer with an open requirement, the preferred one first, with the allowance used", async () => {
    fromMock
      .mockReturnValueOnce(
        query({
          data: [
            { id: "r1", title: "Welders", organization_id: "e2" },
            { id: "r2", title: "Fitters", organization_id: "e2" },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        query({
          data: [
            { requirement_id: "r1", organization_id: P1, status: "withdrawn" },
            { requirement_id: "r1", organization_id: "other", status: "invited" },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(query({ data: [{ requirement_id: "r2", organization_id: P1 }], error: null }));
    rpcMock.mockResolvedValue({ data: [{ used: 1, limit_value: 3, applies: true, plan_name: "Basic" }], error: null });
    expect(await getInviteChoices([P1], "second")).toEqual({
      employers: [
        {
          organizationId: "e2",
          slug: "second",
          name: "Second GmbH",
          requirements: [
            { id: "r1", title: "Welders", used: 1 },
            { id: "r2", title: "Fitters", used: 0 },
          ],
          limit: 3,
          applies: true,
          planName: "Basic",
        },
      ],
      invited: { [P1]: { r1: "withdrawn", r2: "responded" } },
    });
  });

  it("answers nothing, rather than failing the page, when a read fails", async () => {
    fromMock.mockReturnValueOnce(query({ data: null, error: { message: "permission denied", code: "42501" } }));
    expect(await getInviteChoices([P1])).toBeNull();
    expect(faultMock).toHaveBeenCalledWith("Reading the invite choices", { message: "permission denied", code: "42501" });
  });

  it("answers nothing for a viewer who manages no employer", async () => {
    organizationsMock.mockResolvedValue([{ id: "e3", slug: "m", displayName: "M", type: "employer", role: "member", suspended: false }]);
    expect(await getInviteChoices([P1])).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("the invitations of the suggestions page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers the statuses by partner and the allowance, a partner that responded from the marketplace as Responded", async () => {
    fromMock.mockReturnValueOnce(query({ data: [{ requirement_id: "r1", organization_id: "marketplace" }], error: null }));
    rpcMock
      .mockResolvedValueOnce({
        data: [
          {
            id: "i1",
            organization_id: P1,
            partner_name: "Q1",
            partner_slug: "q1",
            partner_type: "recruitment_company",
            status: "viewed",
            source: "saved",
            suggestion_criteria: null,
            invited_at: "2026-10-28T08:00:00Z",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ used: 1, limit_value: 3, applies: true, plan_name: "Basic" }], error: null });
    expect(await getSuggestionInvitations("e1", "r1")).toEqual({
      invitations: { [P1]: "viewed", marketplace: "responded" },
      usage: { used: 1, limit: 3, applies: true, planName: "Basic" },
    });
  });

  it("answers nothing when a read fails, so the page hides the invite controls", async () => {
    fromMock.mockReturnValue(query({ data: [], error: null }));
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", code: "42501" } });
    expect(await getSuggestionInvitations("e1", "r1")).toBeNull();
  });

  it("names the saved partners as a source", () => {
    expect(invitationSourceLabels.saved).toBe("Invited from your saved partners");
  });
});
