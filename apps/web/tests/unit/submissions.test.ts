import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidateNextSteps,
  candidateSubmissionLabels,
  isWithdrawable,
  partnerNextSteps,
  partnerSubmissionLabels,
  submissionCountText,
  submissionTones,
  submissionUsageText,
  type SubmissionStatus,
} from "@/lib/submissions/presentation";
import { answerRefusal, SUBMISSION_MESSAGES, submitRefusal, withdrawRefusal } from "@/lib/submissions/refusal";
import {
  approveFormSchema,
  CANDIDATE_EMAIL_INVALID,
  CANDIDATE_EMAIL_REQUIRED,
  CANDIDATE_EMAIL_TOO_LONG,
  SHARE_CONSENT_REQUIRED,
  SUBMISSION_NOTE_TOO_LONG,
  submitCandidateFormSchema,
} from "@/lib/validation/submission";
import { fieldErrors } from "@/lib/validation/sign-up";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const promptsMock = vi.hoisted(() => vi.fn());
const eligibilityMock = vi.hoisted(() => vi.fn());
const responseMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, requireUser: requireUserMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/usage", () => ({ getUsagePrompts: promptsMock }));
vi.mock("@/lib/dal/applications", () => ({ getApplyLimits: async () => ({ coverNoteMaxChars: 2000, documentsMax: 2 }) }));
vi.mock("@/lib/dal/responses", () => ({ getResponseEligibility: eligibilityMock, getResponse: responseMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { approveSubmission, declineSubmission, submitCandidate, withdrawSubmission } = await import("@/lib/actions/submissions");
const { revalidatePath } = await import("next/cache");
const { getMySubmission, getSubmissionTarget, listPartnerSubmissions, listRequirementSubmissions, submissionsReleased } = await import(
  "@/lib/dal/submissions"
);

const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const SUBMISSION = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const DOCUMENT = "0a1b2c3d-0000-4000-8000-0000000000d1";
const PARTNER = { id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", slug: "s1", type: "recruitment_company", role: "member", suspended: false };
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

function errorsFor(values: Record<string, unknown>): Record<string, string> {
  const result = submitCandidateFormSchema.safeParse({ email: "worker@example.com", note: "", ...values });
  return result.success ? {} : fieldErrors(result.error);
}

beforeEach(() => {
  rpcMock.mockReset();
  promptsMock.mockReset();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ user: { id: "u" }, organization: PARTNER });
  requireUserMock.mockResolvedValue({ id: "w", accountKind: "worker" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the submission request form (FR-O4 AC12)", () => {
  it("takes a trimmed, lower-cased address of up to 254 characters", () => {
    expect(submitCandidateFormSchema.parse({ email: "  Worker@Example.COM ", note: "  Hello  " })).toEqual({
      email: "worker@example.com",
      note: "Hello",
    });
    expect(errorsFor({ email: "" }).email).toBe(CANDIDATE_EMAIL_REQUIRED);
    expect(errorsFor({ email: "not-an-email" }).email).toBe(CANDIDATE_EMAIL_INVALID);
    expect(errorsFor({ email: `${"a".repeat(243)}@example.com` }).email).toBe(CANDIDATE_EMAIL_TOO_LONG);
    expect(errorsFor({ email: `${"a".repeat(242)}@example.com` }).email).toBeUndefined();
  });

  it("bounds the note to 1,000 characters without control characters", () => {
    expect(errorsFor({ note: "n".repeat(1000) }).note).toBeUndefined();
    expect(errorsFor({ note: "n".repeat(1001) }).note).toBe(SUBMISSION_NOTE_TOO_LONG);
    expect(errorsFor({ note: "line one\nline two" }).note).toBeUndefined();
    expect(errorsFor({ note: "bell\u0007" }).note).toBe("Remove the special characters.");
  });
});

describe("the candidate's approval form (FR-O4 AC5)", () => {
  const schema = approveFormSchema(2);

  it("needs the consent and allows no document", () => {
    expect(schema.safeParse({ documentIds: [], consent: true }).success).toBe(true);
    const refused = schema.safeParse({ documentIds: [], consent: false });
    expect(refused.success ? {} : fieldErrors(refused.error)).toEqual({ consent: SHARE_CONSENT_REQUIRED });
  });

  it("counts each document once, up to the apply limit", () => {
    expect(schema.parse({ documentIds: [DOCUMENT, DOCUMENT], consent: true }).documentIds).toEqual([DOCUMENT]);
    const three = ["0a1b2c3d-0000-4000-8000-0000000000d1", "0a1b2c3d-0000-4000-8000-0000000000d2", "0a1b2c3d-0000-4000-8000-0000000000d3"];
    expect(schema.safeParse({ documentIds: three, consent: true }).success).toBe(false);
  });
});

describe("the submission refusals in words", () => {
  it("maps submit_candidate's refusals to the fields, the limit and messages (AC3, AC4)", () => {
    expect(submitRefusal({ message: "CHARA_INVALID_INPUT", details: "p_email" })).toEqual({ kind: "field", field: "email", message: CANDIDATE_EMAIL_INVALID });
    expect(submitRefusal({ message: "CHARA_INVALID_INPUT", details: "p_note" })).toEqual({ kind: "field", field: "note", message: SUBMISSION_NOTE_TOO_LONG });
    expect(submitRefusal({ message: "CHARA_LIMIT_REACHED", details: "candidate_submissions_per_month" })).toEqual({ kind: "limit" });
    expect(submitRefusal({ message: "CHARA_LIMIT_REACHED", details: "markets" })).toEqual({ kind: "fault" });
    expect(submitRefusal({ message: "CHARA_FORBIDDEN", details: "submissions_not_open" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.notOpenToYou });
    expect(submitRefusal({ message: "CHARA_FORBIDDEN", details: "release_off" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.releaseOff });
    expect(submitRefusal({ message: "CHARA_CONSENT_REQUIRED", details: "employer-pays-commitment" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.commitment });
    expect(submitRefusal({ message: "CHARA_FEATURE_NOT_IN_PLAN", details: "job_order_access" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.plan });
    expect(submitRefusal({ message: "CHARA_INVALID_STATE", details: "requirement_not_open" })).toEqual({
      kind: "message",
      message: SUBMISSION_MESSAGES.requirementNotOpen,
    });
    expect(submitRefusal({ message: "boom", details: null })).toEqual({ kind: "fault" });
  });

  it("maps the candidate's refusals: the passport, another partner, the states (AC5, AC8)", () => {
    expect(answerRefusal({ message: "CHARA_PROFILE_INCOMPLETE", details: "occupation_id, last_name" })).toEqual({
      kind: "profile",
      missing: ["occupation_id", "last_name"],
    });
    expect(answerRefusal({ message: "CHARA_CONFLICT", details: "already_submitted" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.alreadySubmitted });
    expect(answerRefusal({ message: "CHARA_INVALID_STATE", details: "expired" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.expired });
    expect(answerRefusal({ message: "CHARA_INVALID_STATE", details: "declined_by_candidate" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.answered });
    expect(answerRefusal({ message: "CHARA_INVALID_STATE", details: "requirement_not_open" })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.closed });
    expect(answerRefusal({ message: "CHARA_INVALID_INPUT", details: "p_document_ids" })).toEqual({ kind: "field", message: SUBMISSION_MESSAGES.documents });
    expect(answerRefusal({ message: "CHARA_DOCUMENT_NOT_SCANNED", details: null })).toEqual({ kind: "message", message: SUBMISSION_MESSAGES.scanning });
    expect(answerRefusal({ message: "CHARA_SETTING_MISSING", details: "sharing-notice" })).toEqual({ kind: "fault" });
  });

  it("answers a withdrawal of a withdrawn submission as done", () => {
    expect(withdrawRefusal({ message: "CHARA_INVALID_STATE", details: "withdrawn" })).toEqual({ kind: "withdrawn" });
    expect(withdrawRefusal({ message: "CHARA_INVALID_STATE", details: "declined_by_candidate" })).toEqual({
      kind: "message",
      message: SUBMISSION_MESSAGES.notWithdrawable,
    });
  });
});

describe("the submission in words (NFR-U4)", () => {
  it("has a label, a tone and a next step for every status", () => {
    const statuses = Object.keys(partnerSubmissionLabels) as SubmissionStatus[];
    expect(statuses).toHaveLength(11);
    for (const status of statuses) {
      expect(candidateSubmissionLabels[status]).toBeTruthy();
      expect(submissionTones[status]).toBeTruthy();
      expect(partnerNextSteps[status]).toBeTruthy();
      if (status !== "awaiting_candidate") expect(candidateNextSteps[status]).toBeTruthy();
    }
    expect(partnerSubmissionLabels.awaiting_candidate).toBe("Awaiting candidate");
    expect(partnerSubmissionLabels.declined_by_candidate).toBe("Declined by candidate");
  });

  it("offers withdrawal from the approval on, until withdrawn (AC9)", () => {
    expect(isWithdrawable("submitted", "2026-11-01T00:00:00Z")).toBe(true);
    expect(isWithdrawable("hired", "2026-11-01T00:00:00Z")).toBe(true);
    expect(isWithdrawable("withdrawn", "2026-11-01T00:00:00Z")).toBe(false);
    expect(isWithdrawable("declined_by_candidate", null)).toBe(false);
  });

  it("writes the usage and the count", () => {
    expect(submissionUsageText(5, 25)).toBe("5 of 25 submissions used this month");
    expect(submissionCountText(1, false)).toBe("1 candidate");
    expect(submissionCountText(20, true)).toBe("The newest 20 candidates");
  });
});

describe("the partner's submission action", () => {
  it("sends the parsed address and note and answers the same reply for any address (AC2)", async () => {
    rpcMock.mockResolvedValue({ data: [{ id: SUBMISSION, status: "awaiting_candidate", existing: false }], error: null });
    expect(await submitCandidate("s1", REQUIREMENT, { email: " W@Example.com ", note: "" })).toEqual({ sent: { existing: false } });
    expect(rpcMock).toHaveBeenCalledWith("submit_candidate", { p_org: PARTNER.id, p_requirement: REQUIREMENT, p_email: "w@example.com", p_note: undefined });
    rpcMock.mockResolvedValue({ data: [{ id: SUBMISSION, status: "awaiting_candidate", existing: true }], error: null });
    expect(await submitCandidate("s1", REQUIREMENT, { email: "w@example.com", note: "Strong welder" })).toEqual({ sent: { existing: true } });
  });

  it("returns field errors without calling the database", async () => {
    expect((await submitCandidate("s1", REQUIREMENT, { email: "not-an-email", note: "x".repeat(1001) })).errors).toEqual({
      email: CANDIDATE_EMAIL_INVALID,
      note: SUBMISSION_NOTE_TOO_LONG,
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("answers the monthly limit with the upgrade prompt, or in words without one (AC3)", async () => {
    vi.mocked(revalidatePath).mockClear();
    const prompt = { limitKey: "candidate_submissions_per_month", used: 25, limit: 25, resetsAt: null, planName: "Partner", comparison: null };
    promptsMock.mockResolvedValue({ candidate_submissions_per_month: prompt });
    rpcMock.mockResolvedValue(refusal("CHARA_LIMIT_REACHED", "candidate_submissions_per_month"));
    expect(await submitCandidate("s1", REQUIREMENT, { email: "w@example.com", note: "" })).toEqual({ limitReached: prompt });
    promptsMock.mockRejectedValue(new Error("down"));
    expect(await submitCandidate("s1", REQUIREMENT, { email: "w@example.com", note: "" })).toEqual({ message: SUBMISSION_MESSAGES.limit });
    // The form keeps what was typed: nothing re-renders the page into the limit panel (FR-R1 AC11).
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses while the release is off, and logs an unexpected error with a reference", async () => {
    releasedMock.mockResolvedValue(false);
    expect(await submitCandidate("s1", REQUIREMENT, { email: "w@example.com", note: "" })).toEqual({ message: SUBMISSION_MESSAGES.releaseOff });
    expect(rpcMock).not.toHaveBeenCalled();
    releasedMock.mockResolvedValue(true);
    rpcMock.mockResolvedValue(refusal("boom", "secret detail"));
    const { message } = await submitCandidate("s1", REQUIREMENT, { email: "w@example.com", note: "" });
    expect(message).toMatch(/Reference: [0-9A-F]{8}\./);
    expect(message).not.toContain("secret");
  });
});

describe("the candidate's actions", () => {
  it("approves with the chosen documents (AC5)", async () => {
    rpcMock.mockResolvedValue({ data: "submitted", error: null });
    expect(await approveSubmission(SUBMISSION, { documentIds: [DOCUMENT], consent: true })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("approve_submission", { p_submission: SUBMISSION, p_document_ids: [DOCUMENT] });
  });

  it("refuses an approval without the consent, and a company user, without calling the database", async () => {
    expect((await approveSubmission(SUBMISSION, { documentIds: [], consent: false })).errors).toEqual({ consent: SHARE_CONSENT_REQUIRED });
    requireUserMock.mockResolvedValue({ id: "c", accountKind: "company" });
    expect(await approveSubmission(SUBMISSION, { documentIds: [], consent: true })).toEqual({ message: SUBMISSION_MESSAGES.requestNotFound });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the passport fields still missing with their sections", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_PROFILE_INCOMPLETE", "occupation_id"));
    expect(await approveSubmission(SUBMISSION, { documentIds: [], consent: true })).toEqual({
      message: "Complete your passport before you approve.",
      missing: [{ label: "Occupation", section: "occupation" }],
    });
  });

  it("says another company already submitted the candidate (AC8)", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_CONFLICT", "already_submitted"));
    expect(await approveSubmission(SUBMISSION, { documentIds: [], consent: true })).toEqual({ message: SUBMISSION_MESSAGES.alreadySubmitted });
  });

  it("declines and withdraws, a second withdrawal being done (AC7, AC9)", async () => {
    rpcMock.mockResolvedValue({ data: "declined_by_candidate", error: null });
    expect(await declineSubmission(SUBMISSION)).toEqual({ done: true });
    expect(rpcMock).toHaveBeenLastCalledWith("decline_submission", { p_submission: SUBMISSION });
    rpcMock.mockResolvedValue({ data: "withdrawn", error: null });
    expect(await withdrawSubmission(SUBMISSION)).toEqual({});
    expect(rpcMock).toHaveBeenLastCalledWith("withdraw_submission", { p_submission: SUBMISSION });
    rpcMock.mockResolvedValue(refusal("CHARA_INVALID_STATE", "withdrawn"));
    expect(await withdrawSubmission(SUBMISSION)).toEqual({});
    expect(await withdrawSubmission("not-a-uuid")).toEqual({ message: SUBMISSION_MESSAGES.notWithdrawable });
  });
});

const requestRow = {
  id: SUBMISSION,
  partner_name: "Manila Recruit",
  partner_slug: "manila-recruit",
  title: "Welders for a shipyard",
  country_code: "MC",
  country_name: "Monaco",
  city_region: null,
  start_date: "2027-03-01",
  workers_needed: 100,
  employer_name: null,
  note: null,
  created_at: "2026-11-10T00:00:00Z",
  expires_at: "2026-11-24T00:00:00Z",
  submitted_by_partner: null,
};

describe("the submission reads", () => {
  it("needs both release switches", async () => {
    releasedMock.mockImplementation(async (name: string) => name === "release_candidate_submissions");
    expect(await submissionsReleased()).toBe(false);
    releasedMock.mockResolvedValue(true);
    expect(await submissionsReleased()).toBe(true);
  });

  it("finds the candidate's request or submission by id, and nothing for another id", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "list_my_submission_requests"
        ? { data: [requestRow], error: null }
        : {
            data: [{ ...requestRow, id: REQUIREMENT, status: "submitted", decided_at: null, worker_approved_at: "2026-11-11T00:00:00Z", withdrawn_at: null }],
            error: null,
          },
    );
    expect(await getMySubmission(SUBMISSION)).toMatchObject({ kind: "request", request: { partnerName: "Manila Recruit", employerName: null } });
    expect(await getMySubmission(REQUIREMENT)).toMatchObject({ kind: "answered", submission: { status: "submitted", approvedAt: "2026-11-11T00:00:00Z" } });
    expect(await getMySubmission(DOCUMENT)).toBeNull();
  });

  it("pages the partner's submissions and shows the first page for an unknown cursor", async () => {
    const row = {
      id: SUBMISSION,
      requirement_id: REQUIREMENT,
      title: "Welders",
      status: "awaiting_candidate",
      invited_email: "w@example.com",
      candidate_name: null,
      note: null,
      created_at: "2026-11-10T00:00:00Z",
      decided_at: null,
      worker_approved_at: null,
      withdrawn_at: null,
      next_cursor: SUBMISSION,
    };
    rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", "p_cursor")).mockResolvedValueOnce({ data: [row], error: null });
    const page = await listPartnerSubmissions(PARTNER.id, REQUIREMENT, DOCUMENT);
    expect(page).toMatchObject({ cursorIgnored: true, nextCursor: SUBMISSION, submissions: [{ invitedEmail: "w@example.com", candidateName: null }] });
    expect(rpcMock).toHaveBeenLastCalledWith("list_partner_submissions", { p_org: PARTNER.id, p_requirement: REQUIREMENT, p_cursor: undefined, p_limit: 20 });
    rpcMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "release_off"));
    await expect(listPartnerSubmissions(PARTNER.id, null, null)).rejects.toThrow("The submissions could not be loaded");
  });

  it("reads the employer's approved submissions", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: SUBMISSION,
          partner_organization_id: PARTNER.id,
          partner_name: "Manila Recruit",
          partner_slug: "manila-recruit",
          status: "submitted",
          candidate_name: "Ana Reyes",
          profile_snapshot: {},
          note: null,
          created_at: "2026-11-10T00:00:00Z",
          worker_approved_at: "2026-11-11T00:00:00Z",
          withdrawn_at: null,
        },
      ],
      error: null,
    });
    expect(await listRequirementSubmissions("e", REQUIREMENT)).toEqual([
      {
        id: SUBMISSION,
        partnerName: "Manila Recruit",
        partnerSlug: "manila-recruit",
        status: "submitted",
        candidateName: "Ana Reyes",
        note: null,
        approvedAt: "2026-11-11T00:00:00Z",
        withdrawnAt: null,
      },
    ]);
  });

  it("opens submissions to a selected partner, or a shortlisted one allowed, on an open requirement (FR-O3 AC8)", async () => {
    eligibilityMock.mockResolvedValue({ responseId: SUBMISSION });
    const response = { id: SUBMISSION, requirementId: REQUIREMENT, title: "Welders", employerName: null, requirementStatus: "open" };
    responseMock.mockResolvedValue({ ...response, status: "selected", submissionsAllowed: true });
    expect(await getSubmissionTarget(PARTNER.id, REQUIREMENT)).toEqual({
      requirementId: REQUIREMENT,
      responseId: SUBMISSION,
      title: "Welders",
      employerName: null,
      requirementStatus: "open",
      open: true,
    });
    responseMock.mockResolvedValue({ ...response, status: "shortlisted", submissionsAllowed: false });
    expect((await getSubmissionTarget(PARTNER.id, REQUIREMENT))?.open).toBe(false);
    responseMock.mockResolvedValue({ ...response, status: "selected", submissionsAllowed: true, requirementStatus: "paused" });
    expect((await getSubmissionTarget(PARTNER.id, REQUIREMENT))?.open).toBe(false);
    eligibilityMock.mockResolvedValue({ responseId: null });
    expect(await getSubmissionTarget(PARTNER.id, REQUIREMENT)).toBeNull();
  });
});
