import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, requireUser: vi.fn() }));
vi.mock("@/lib/fault", () => ({ logFault: () => "ref-1", faultMessage: (reference: string) => `Something went wrong (${reference})` }));

const { sendInquiry } = await import("@/lib/actions/connection-actions");

const PARTNER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const BODY = { body: "We share candidates for welding roles in Hamburg." };

function member(type: "employer" | "recruitment_company" | "staffing_company") {
  requireOrgRoleMock.mockResolvedValue({ organization: { id: ORG, slug: "rekrut", displayName: "Rekrut", type, role: "member", suspended: false } });
}

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
});

describe("sendInquiry for an employer and for a partner (FR-P2 AC1, AC2; D91)", () => {
  it("sends an employer's inquiry through send_inquiry", async () => {
    member("employer");
    rpcMock.mockResolvedValue({ data: CONVERSATION, error: null });
    expect(await sendInquiry("rekrut", PARTNER, BODY, "/en/partners/plain")).toEqual({
      done: { href: `/en/org/rekrut/messages/${CONVERSATION}` },
    });
    expect(rpcMock).toHaveBeenCalledWith("send_inquiry", { p_org: ORG, p_partner: PARTNER, p_body: BODY.body });
  });

  it("sends a partner's inquiry through send_partner_inquiry, for a member of either kind of organisation", async () => {
    member("recruitment_company");
    rpcMock.mockResolvedValue({ data: CONVERSATION, error: null });
    expect((await sendInquiry("rekrut", PARTNER, BODY, "/en/partners/plain")).done).toBeDefined();
    expect(rpcMock).toHaveBeenCalledWith("send_partner_inquiry", { p_org: ORG, p_partner: PARTNER, p_body: BODY.body });
    expect(requireOrgRoleMock.mock.calls[0]?.[3]).toMatchObject({ partner: "either" });
  });

  it("refuses a partner's inquiry while the partner directories are off, without calling the database", async () => {
    member("staffing_company");
    releasedMock.mockImplementation(async (key: string) => key !== "release_partner_directories");
    expect(await sendInquiry("rekrut", PARTNER, BODY, "/en/partners/plain")).toEqual({ message: "Messages are not available at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("points a refused second inquiry of the pair to its conversation, whichever side sent the first", async () => {
    member("recruitment_company");
    rpcMock.mockImplementation(async (name: string) =>
      name === "open_inquiry"
        ? { data: [{ connection_id: PARTNER, conversation_id: CONVERSATION }], error: null }
        : { data: null, error: { message: "CHARA_CONFLICT", details: "open_inquiry" } },
    );
    expect(await sendInquiry("rekrut", PARTNER, BODY, "/en/partners/plain")).toEqual({
      message: "An inquiry between your company and this company is still waiting for an answer. Continue in its conversation.",
      existingHref: `/en/org/rekrut/messages/${CONVERSATION}`,
    });
  });

  it("says why the database refused a partner pair, the company itself or an unlisted sender", async () => {
    member("staffing_company");
    for (const [details, message] of [
      ["partner_pair_not_allowed", "A staffing company sends inquiries to recruitment companies only."],
      ["self", "Your company cannot send an inquiry to itself."],
      ["not_listed", "Your company can contact other companies once it is listed in the directory."],
    ] as const) {
      rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details } });
      expect(await sendInquiry("staffit", PARTNER, BODY, "/en/partners/plain"), details).toEqual({ message });
    }
  });
});
