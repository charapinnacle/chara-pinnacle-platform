import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/release", () => ({ isReleased: async () => true }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, requireCandidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { sendContactRequest } = await import("@/lib/actions/contact-requests");

const ORG = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const message = "We are hiring welders for our yard.";

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ organization: { id: ORG, slug: "acme" } });
  rpcMock.mockResolvedValue({ error: null });
});

describe("sendContactRequest (FR-Q3 AC6, AC12)", () => {
  it("sends the destination the card was shaped for, so the rules checked are the card's", async () => {
    expect(await sendContactRequest("acme", CARD, { message, jobId: "" }, "AT")).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("send_contact_request", { p_org: ORG, p_card: CARD, p_message: message, p_destination: "AT" });
  });

  it("leaves the destination to the database when the card was shaped for the organisation's country", async () => {
    expect(await sendContactRequest("acme", CARD, { message, jobId: "" })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("send_contact_request", { p_org: ORG, p_card: CARD, p_message: message });
  });

  it("refuses a destination that is not a country code before it reaches the database", async () => {
    for (const destination of ["at", "AUT", "", "A1"]) {
      expect(await sendContactRequest("acme", CARD, { message, jobId: "" }, destination)).toEqual({
        message: expect.any(String),
      });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
