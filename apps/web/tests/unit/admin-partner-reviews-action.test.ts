import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const evidenceMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/partner-evidence", () => ({ requestPartnerReviewEvidence: evidenceMock }));
vi.mock("@/lib/dal/admin", () => ({ adminClient: async () => ({ rpc: rpcMock }) }));

const { decidePartner, openPartnerEvidence } = await import("@/lib/actions/admin-partner-reviews");

const ORG = "6f1c1c2e-8a3b-4c55-9b1e-2d3f4a5b6c7d";
const LICENCE = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const failure = (message: string, details = "") => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["trust_safety"] });
  rpcMock.mockResolvedValue({ data: { review_status: "listed" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("decidePartner (FR-J4 AC3, AC4)", () => {
  it("asks for the Trust & Safety role, sends the trimmed reason and redraws the queue and the review page", async () => {
    expect(await decidePartner({ organizationId: ORG, decision: "approve", reason: "  Registry entry and website match  ", infoStep: null })).toEqual({
      done: true,
    });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety"]);
    expect(rpcMock).toHaveBeenCalledWith("admin_decide_partner", {
      p_org: ORG,
      p_decision: "approve",
      p_reason: "Registry entry and website match",
      p_info_step: undefined,
    });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/partners");
    expect(revalidateMock).toHaveBeenCalledWith(`/en/admin/partners/${ORG}`);
  });

  it("sends the step of a request for information", async () => {
    await decidePartner({ organizationId: ORG, decision: "request_info", reason: "Please add a source country.", infoStep: "where_you_serve" });
    expect(rpcMock).toHaveBeenCalledWith("admin_decide_partner", expect.objectContaining({ p_decision: "request_info", p_info_step: "where_you_serve" }));
  });

  it("refuses a short reason or a missing step with the field error and calls nothing", async () => {
    expect((await decidePartner({ organizationId: ORG, decision: "decline", reason: "Too short", infoStep: null })).errors).toEqual({
      reason: "Give a reason of at least 10 characters",
    });
    expect((await decidePartner({ organizationId: ORG, decision: "request_info", reason: "Please add a country.", infoStep: null })).errors).toEqual({
      infoStep: "Choose the step to reopen",
    });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends nothing while release 2a is off", async () => {
    releasedMock.mockResolvedValue(false);
    expect(await decidePartner({ organizationId: ORG, decision: "approve", reason: "Registry entry matches.", infoStep: null })).toEqual({
      message: "Partner reviews are not open at the moment.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [failure("CHARA_INVALID_TRANSITION", "listed"), { message: "This partner was decided by someone else. Reload the page." }],
    [failure("CHARA_FORBIDDEN", "own_organization"), { message: "You are a member of this company, so another reviewer decides." }],
    [failure("CHARA_INVALID_INPUT", "reason"), { errors: { reason: "Give a reason of 10 to 2000 characters" } }],
    [failure("CHARA_FORBIDDEN"), { message: "You are not allowed to do this." }],
  ])("tells the reviewer what the database refused (%o)", async (answer, expected) => {
    rpcMock.mockResolvedValue(answer);
    expect(await decidePartner({ organizationId: ORG, decision: "approve", reason: "Registry entry matches.", infoStep: null })).toEqual(expected);
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("sends a session whose two-step verification lapsed to confirm it and back to the review page", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(decidePartner({ organizationId: ORG, decision: "approve", reason: "Registry entry matches.", infoStep: null })).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent(`/en/admin/partners/${ORG}`)}`,
    );
  });
});

describe("openPartnerEvidence (FR-J2 AC6, FR-J4 AC2)", () => {
  it("is for the two reviewer roles and returns the link of the broker", async () => {
    evidenceMock.mockResolvedValue({ url: "https://storage.example/licence.pdf" });
    expect(await openPartnerEvidence(LICENCE)).toEqual({ url: "https://storage.example/licence.pdf" });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety", "verification_reviewer"]);
    expect(evidenceMock).toHaveBeenCalledWith(LICENCE);
  });

  it("explains a file not yet checked and refuses a bad id without calling the broker", async () => {
    evidenceMock.mockResolvedValue({ refusal: "not_scanned" });
    expect(await openPartnerEvidence(LICENCE)).toEqual({ message: "This file cannot be opened until it has been checked." });
    evidenceMock.mockClear();
    expect((await openPartnerEvidence("../x")).message).toEqual(expect.any(String));
    expect(evidenceMock).not.toHaveBeenCalled();
  });
});
