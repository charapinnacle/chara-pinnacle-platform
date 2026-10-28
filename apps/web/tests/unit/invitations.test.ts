import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageText } from "@/lib/billing/limits";
import type { PublicPlan } from "@/lib/billing/pricing";
import {
  atInvitationLimit,
  canAnswer,
  canWithdraw,
  employerStatusLabels,
  inboxQuery,
  invitationStatuses,
  invitationUsageText,
  inviteConfirmation,
  isFullInvitation,
  parseInboxParams,
  partnerStatusLabels,
} from "@/lib/invitations/presentation";
import { answerRefusal, INVITATION_MESSAGES, inviteRefusal, withdrawRefusal } from "@/lib/invitations/refusal";
import { declineFormSchema, inviteSelectionSchema, inviteToRequirementSchema } from "@/lib/validation/invitation";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const plansMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, getCurrentUser: vi.fn() }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/pricing", () => ({ listPublicPlans: plansMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { answerInvitation, invitePartners, withdrawInvitation } = await import("@/lib/actions/invitations");

const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const P1 = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const P2 = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const INVITATION = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

function plan(code: string, name: string, invitations: number | null): PublicPlan {
  return {
    code,
    name,
    priceMinor: 0,
    currency: "EUR",
    interval: "month",
    trialDays: 30,
    contactSales: false,
    limits: { partner_invitations_per_requirement: invitations },
    features: [],
  };
}

describe("the status words of an invitation (FR-O1 AC9, NFR-U4)", () => {
  it("reads as the AC names them for the employer, and says what happened for the partner", () => {
    expect(invitationStatuses.map((status) => employerStatusLabels[status])).toEqual([
      "Invited",
      "Invited (seen)",
      "Accepted",
      "Declined",
      "Responded",
      "Withdrawn",
      "Expired",
    ]);
    expect(partnerStatusLabels.withdrawn).toBe("Withdrawn by the employer");
    expect(partnerStatusLabels.invited).toBe("New");
  });

  it("follows the moves of the database: withdraw before a response, answer while unanswered, full fields while live", () => {
    expect(invitationStatuses.filter(canWithdraw)).toEqual(["invited", "viewed", "accepted"]);
    expect(invitationStatuses.filter(canAnswer)).toEqual(["invited", "viewed"]);
    expect(invitationStatuses.filter(isFullInvitation)).toEqual(["invited", "viewed", "accepted", "responded"]);
  });
});

describe("the invitation allowance (FR-O1 AC9, AC12)", () => {
  it("counts the invitations used against the plan, or those sent without a limit", () => {
    expect(invitationUsageText({ used: 5, limit: 10, applies: true, planName: "Professional" })).toBe("5 of 10 invitations used");
    expect(invitationUsageText({ used: 3, limit: 3, applies: true, planName: "Basic" })).toBe("3 of 3 invitations used");
    expect(invitationUsageText({ used: 1, limit: null, applies: true, planName: "Enterprise" })).toBe("1 invitation sent");
    expect(invitationUsageText({ used: 4, limit: 3, applies: false, planName: "Basic" })).toBe("4 invitations sent");
    expect(atInvitationLimit({ used: 3, limit: 3, applies: true, planName: "Basic" })).toBe(true);
    expect(atInvitationLimit({ used: 2, limit: 3, applies: true, planName: "Basic" })).toBe(false);
    expect(atInvitationLimit({ used: 3, limit: 3, applies: false, planName: "Basic" })).toBe(false);
    expect(usageText("partner_invitations_per_requirement", "employer", 3, 3)).toBe("3 of 3 invitations");
  });

  it("confirms the partners invited and names the real status of one that already had an invitation (V41 note)", () => {
    expect(
      inviteConfirmation([
        { partnerId: P1, name: "Q1 Recruit", status: "invited", alreadyInvited: false },
        { partnerId: P2, name: "Q2 Staff", status: "invited", alreadyInvited: false },
        { partnerId: "x", name: "Gone Ltd", status: "withdrawn", alreadyInvited: true },
      ]),
    ).toEqual({
      sent: "Invitations sent to Q1 Recruit and Q2 Staff.",
      already: ["Gone Ltd already has an invitation to this requirement: Withdrawn."],
    });
    expect(inviteConfirmation([{ partnerId: P1, name: "Q1 Recruit", status: "viewed", alreadyInvited: true }])).toEqual({
      sent: null,
      already: ["Q1 Recruit already has an invitation to this requirement: Invited (seen)."],
    });
  });
});

describe("the error mapping of the invitations (FR-O1)", () => {
  it("maps the plan's limit to the upgrade prompt and the daily cap to a message without one", () => {
    expect(inviteRefusal(refusal("CHARA_LIMIT_REACHED", "partner_invitations_per_requirement").error)).toEqual({ kind: "limit" });
    expect(inviteRefusal(refusal("CHARA_RATE_LIMITED", "partner_invitations_per_day").error)).toEqual({
      kind: "message",
      message: INVITATION_MESSAGES.dailyCap,
    });
    expect(inviteRefusal(refusal("CHARA_RATE_LIMITED", null).error)).toEqual({ kind: "message", message: INVITATION_MESSAGES.tooManyChanges });
  });

  it("maps an unavailable partner without naming it, and the other refusals of invite_partners", () => {
    const unavailable = inviteRefusal(refusal("CHARA_INVALID_INPUT", "partner_unavailable").error);
    expect(unavailable).toEqual({ kind: "message", message: INVITATION_MESSAGES.unavailable });
    expect(JSON.stringify(unavailable)).not.toContain("partner_unavailable");
    expect(inviteRefusal(refusal("CHARA_INVALID_INPUT", "p_partners").error)).toEqual({ kind: "message", message: INVITATION_MESSAGES.tooMany });
    expect(inviteRefusal(refusal("CHARA_INVALID_STATE", "requirement_not_open").error)).toEqual({ kind: "message", message: INVITATION_MESSAGES.notOpen });
    expect(inviteRefusal(refusal("CHARA_NOT_FOUND", null, "P0002").error)).toEqual({ kind: "message", message: INVITATION_MESSAGES.notFound });
    expect(inviteRefusal(refusal("CHARA_FORBIDDEN", "release_off", "42501").error)).toEqual({ kind: "message", message: INVITATION_MESSAGES.releaseOff });
    expect(inviteRefusal(refusal("CHARA_FORBIDDEN", "aal2_required", "42501").error)).toEqual({ kind: "message", message: INVITATION_MESSAGES.notAllowed });
    expect(inviteRefusal(refusal("CHARA_INVALID_INPUT", "p_source").error)).toEqual({ kind: "fault" });
    expect(inviteRefusal(refusal('duplicate key value violates unique constraint "x"', null, "23505").error)).toEqual({ kind: "fault" });
  });

  it("names the status of an invitation that can no longer be withdrawn or answered", () => {
    expect(withdrawRefusal(refusal("CHARA_INVALID_STATE", "responded").error)).toEqual({
      kind: "message",
      message: "This invitation is responded and can no longer be withdrawn. Reload the page.",
    });
    expect(answerRefusal(refusal("CHARA_INVALID_STATE", "withdrawn").error)).toEqual({
      kind: "message",
      message: "This invitation is withdrawn by the employer and can no longer be answered. Reload the page.",
    });
    expect(answerRefusal(refusal("CHARA_INVALID_INPUT", "p_reason").error)).toEqual({ kind: "field", message: INVITATION_MESSAGES.reason });
    expect(answerRefusal(refusal("CHARA_FORBIDDEN", "organization_suspended", "42501").error)).toEqual({
      kind: "message",
      message: INVITATION_MESSAGES.suspended,
    });
    expect(answerRefusal(refusal("CHARA_INVALID_INPUT", "p_answer").error)).toEqual({ kind: "fault" });
  });
});

describe("the invitation forms", () => {
  it("accept an empty or trimmed decline reason up to 500 characters, without control characters", () => {
    expect(declineFormSchema.parse({ reason: "  No welders available before March  " })).toEqual({ reason: "No welders available before March" });
    expect(declineFormSchema.parse({ reason: "" })).toEqual({ reason: "" });
    expect(declineFormSchema.safeParse({ reason: "a\nb" }).success).toBe(true);
    expect(declineFormSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    expect(declineFormSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(declineFormSchema.safeParse({ reason: "bell\u0007" }).success).toBe(false);
  });

  it("take 1 to 25 selected partners and one requirement", () => {
    expect(inviteSelectionSchema.safeParse({ partners: [] }).success).toBe(false);
    expect(inviteSelectionSchema.safeParse({ partners: Array.from({ length: 25 }, (_, i) => String(i)) }).success).toBe(true);
    expect(inviteSelectionSchema.safeParse({ partners: Array.from({ length: 26 }, (_, i) => String(i)) }).success).toBe(false);
    expect(inviteToRequirementSchema.safeParse({ requirement: "" }).success).toBe(false);
  });

  it("read the status filter and the page of the inbox from its address, leaving out what does not parse", () => {
    expect(parseInboxParams({ status: "declined", cursor: INVITATION })).toEqual({ status: "declined", cursor: INVITATION });
    expect(parseInboxParams({ status: "archived", cursor: "1; drop" })).toEqual({ status: null, cursor: null });
    expect(inboxQuery({ status: "viewed", cursor: null })).toBe("status=viewed");
    expect(inboxQuery({ status: null, cursor: null })).toBe("");
  });
});

describe("the invitation actions (FR-O1 AC8, AC10, AC12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releasedMock.mockResolvedValue(true);
    requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme-bau", type: "employer", role: "admin" } });
    plansMock.mockResolvedValue([plan("employer_starter", "Basic", 3), plan("employer_professional", "Professional", 10)]);
  });

  it("invites and answers with every partner and the allowance after the call", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: [
          { invitation_id: "i1", organization_id: P1, status: "invited", already_invited: false },
          { invitation_id: "i2", organization_id: P2, status: "withdrawn", already_invited: true },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ used: 3, limit_value: 3, applies: true, plan_name: "Basic" }], error: null });
    expect(await invitePartners("acme-bau", { requirementId: REQUIREMENT, partnerIds: [P1, P2], source: "suggestions" })).toEqual({
      outcomes: [
        { partnerId: P1, status: "invited", alreadyInvited: false },
        { partnerId: P2, status: "withdrawn", alreadyInvited: true },
      ],
      usage: { used: 3, limit: 3, applies: true, planName: "Basic" },
    });
    expect(rpcMock).toHaveBeenNthCalledWith(1, "invite_partners", {
      p_org: "org-1",
      p_requirement: REQUIREMENT,
      p_partners: [P1, P2],
      p_source: "suggestions",
    });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { hideFromOutsiders: true });
  });

  it("answers the plan's limit with the upgrade prompt read after the refusal, with the plans that allow more", async () => {
    rpcMock
      .mockResolvedValueOnce(refusal("CHARA_LIMIT_REACHED", "partner_invitations_per_requirement"))
      .mockResolvedValueOnce({ data: [{ used: 3, limit_value: 3, applies: true, plan_name: "Basic" }], error: null });
    expect(await invitePartners("acme-bau", { requirementId: REQUIREMENT, partnerIds: [P1], source: "profile" })).toEqual({
      limitReached: {
        limitKey: "partner_invitations_per_requirement",
        used: 3,
        limit: 3,
        resetsAt: null,
        planName: "Basic",
        comparison: "Professional includes 10 invitations.",
      },
    });
  });

  it("refuses input it cannot parse and anything while release 2b is off, without calling the database", async () => {
    expect(await invitePartners("acme-bau", { requirementId: REQUIREMENT, partnerIds: [P1, P1], source: "profile" })).toEqual({
      message: "We could not complete this request. Try again.",
    });
    expect(await invitePartners("acme-bau", { requirementId: REQUIREMENT, partnerIds: Array.from({ length: 26 }, () => P1), source: "profile" })).toEqual({
      message: "We could not complete this request. Try again.",
    });
    releasedMock.mockResolvedValue(false);
    expect(await withdrawInvitation("acme-bau", { requirementId: REQUIREMENT, invitationId: INVITATION })).toEqual({
      message: INVITATION_MESSAGES.releaseOff,
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("withdraws and maps a refusal; never shows SQL text", async () => {
    rpcMock.mockResolvedValueOnce({ data: "withdrawn", error: null });
    expect(await withdrawInvitation("acme-bau", { requirementId: REQUIREMENT, invitationId: INVITATION })).toEqual({ done: true });
    rpcMock.mockResolvedValueOnce(refusal("relation \"x\" does not exist", null, "42P01"));
    const fault = await withdrawInvitation("acme-bau", { requirementId: REQUIREMENT, invitationId: INVITATION });
    expect(fault.message).toMatch(/^Something went wrong on our side/);
    expect(fault.message).not.toContain("relation");
  });

  it("sends a decline reason only with a decline, and maps a reason the database refuses to the field", async () => {
    requireOrgRoleMock.mockResolvedValue({ organization: { id: "p-1", slug: "manila", type: "recruitment_company", role: "member" } });
    rpcMock.mockResolvedValue({ data: "declined", error: null });
    expect(await answerInvitation("manila", { invitationId: INVITATION, answer: "declined", reason: "  No welders available before March " })).toEqual({
      done: true,
    });
    expect(rpcMock).toHaveBeenLastCalledWith("answer_invitation", {
      p_org: "p-1",
      p_invitation: INVITATION,
      p_answer: "declined",
      p_reason: "No welders available before March",
    });
    expect(requireOrgRoleMock).toHaveBeenLastCalledWith("en", "manila", "member", { mfa: false, hideFromOutsiders: true, partner: true });
    await answerInvitation("manila", { invitationId: INVITATION, answer: "declined", reason: "" });
    expect(rpcMock).toHaveBeenLastCalledWith("answer_invitation", { p_org: "p-1", p_invitation: INVITATION, p_answer: "declined", p_reason: undefined });
    await answerInvitation("manila", { invitationId: INVITATION, answer: "accepted", reason: "ignored" });
    expect(rpcMock).toHaveBeenLastCalledWith("answer_invitation", { p_org: "p-1", p_invitation: INVITATION, p_answer: "accepted", p_reason: undefined });
    expect(await answerInvitation("manila", { invitationId: INVITATION, answer: "declined", reason: "x".repeat(501) })).toEqual({
      errors: { reason: INVITATION_MESSAGES.reason },
    });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", "p_reason"));
    expect(await answerInvitation("manila", { invitationId: INVITATION, answer: "declined", reason: "ok" })).toEqual({
      errors: { reason: INVITATION_MESSAGES.reason },
    });
  });
});
