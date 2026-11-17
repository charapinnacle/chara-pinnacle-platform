import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowedTargets } from "@/lib/applications/stage-machine";
import { employerSubmissionPath, submissionPipelinePath } from "@/lib/routes";
import {
  BULK_MOVE_SKIPPED,
  employerSubmissionLabels,
  pipelineSubmissionStages,
  proposedByLabel,
  submittedByLabel,
} from "@/lib/submissions/presentation";
import { submissionTargets } from "@/lib/submissions/stage-machine";
import { stageChangeFormSchema } from "@/lib/validation/applicant";
import {
  parseSubmissionListParams,
  submissionBulkInputSchema,
  submissionNoteInputSchema,
  submissionStageInputSchema,
} from "@/lib/validation/submission-pipeline";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requestLinkMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/applicant-review", () => ({ requestDocumentLink: requestLinkMock }));
vi.mock("@/lib/quota-refused", () => ({ reportQuotaRefused: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { addSubmissionInternalNote, bulkChangeSubmissionStage, changeSubmissionStage, openSubmissionDocument } = await import(
  "@/lib/actions/submission-pipeline"
);
const { getEmployerSubmission, listEmployerSubmissions, listSubmissionBoard, listSubmissionEvents } = await import(
  "@/lib/dal/submission-pipeline"
);

const ORG = { id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", slug: "acme-bau", role: "member", suspended: false };
const SUBMISSION = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const DOCUMENT = "0a1b2c3d-0000-4000-8000-0000000000d1";
const REASON = "The position was filled.";

const detailRow = {
  id: SUBMISSION,
  organization_id: ORG.id,
  requirement_id: REQUIREMENT,
  requirement_title: "Hamburg welders",
  partner_name: "Manila Recruit",
  partner_slug: "manila-recruit",
  status: "interview",
  candidate_name: "Amina Okafor",
  profile_snapshot: { first_name: "Amina", last_name: "Okafor" },
  note: "Strong welder",
  worker_approved_at: "2026-11-02T00:00:00Z",
  withdrawn_at: null,
  share_active: true,
};

const listRow = (id: string, status: string) => ({
  id,
  requirement_id: REQUIREMENT,
  requirement_title: "Hamburg welders",
  partner_name: "Manila Recruit",
  partner_slug: "manila-recruit",
  status,
  candidate_name: "Amina Okafor",
  worker_approved_at: "2026-11-02T00:00:00Z",
  stage_changed_at: "2026-11-03T00:00:00Z",
  total_count: 2,
});

const refusal = (message: string, details: string | null) => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  rpcMock.mockReset();
  requestLinkMock.mockReset();
  requireOrgRoleMock.mockReset().mockResolvedValue({ organization: ORG });
});

describe("the stages of a submitted candidate (FR-O5 AC2)", () => {
  it("offers the employer the moves of an application, with Submitted in place of Applied", () => {
    for (const stage of pipelineSubmissionStages) {
      const asApplication = stage === "submitted" ? "applied" : stage;
      expect(submissionTargets(stage, { shortlisting: true }), stage).toEqual(allowedTargets(asApplication, "employer", { shortlisting: true }));
    }
    expect(submissionTargets("interview", { shortlisting: true })).not.toContain("shortlisted");
    expect(submissionTargets("hired", { shortlisting: true })).toEqual([]);
    expect(submissionTargets("withdrawn", { shortlisting: true })).toEqual([]);
    expect(submissionTargets("submitted", { shortlisting: false })).toEqual(["interview", "rejected"]);
  });

  it("labels the stages as for direct applicants and the partner on every candidate (AC1, AC9)", () => {
    expect(pipelineSubmissionStages.map((stage) => employerSubmissionLabels[stage])).toEqual([
      "Submitted", "Viewed", "Shortlisted", "Interview", "Offer", "Hired", "Not selected", "Withdrawn",
    ]);
    expect(submittedByLabel("S1")).toBe("Submitted by S1");
    expect(proposedByLabel("S1", "Hamburg welders")).toBe("Proposed by S1 for Hamburg welders");
  });
});

describe("the forms of the pipeline (FR-O5 AC3, AC5)", () => {
  it("needs a decline reason of 10 to the database's maximum, trimmed", () => {
    expect(submissionStageInputSchema.safeParse({ status: "rejected", note: " 123456789 " }).success).toBe(false);
    expect(submissionStageInputSchema.safeParse({ status: "rejected", note: " 1234567890 " }).success).toBe(true);
    expect(submissionStageInputSchema.safeParse({ status: "interview", note: "" }).success).toBe(true);
    const form = stageChangeFormSchema(1000, 10);
    expect(form.safeParse({ status: "rejected", reason: "other", note: "too short" }).success).toBe(false);
    expect(form.safeParse({ status: "rejected", reason: "position_filled", note: "" }).success).toBe(true);
    expect(stageChangeFormSchema(1000).safeParse({ status: "rejected", reason: "other", note: "short" }).success).toBe(true);
  });

  it("takes 1 to 100 candidates for a bulk change and a note of up to 5,000 characters", () => {
    expect(submissionBulkInputSchema.safeParse({ submissionIds: [], status: "shortlisted", note: "" }).success).toBe(false);
    expect(submissionBulkInputSchema.safeParse({ submissionIds: [SUBMISSION], status: "rejected", note: "" }).success).toBe(false);
    expect(submissionBulkInputSchema.safeParse({ submissionIds: [SUBMISSION], status: "shortlisted", note: "" }).success).toBe(true);
    expect(submissionNoteInputSchema.safeParse({ body: "x".repeat(5000) }).success).toBe(true);
    expect(submissionNoteInputSchema.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
    expect(submissionNoteInputSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("reads the source, the requirement, the view, the stage and the page from the address", () => {
    expect(parseSubmissionListParams({})).toEqual({ requirement: null, source: "direct", view: "list", stage: null, page: 1 });
    expect(parseSubmissionListParams({ source: "submissions", view: "board", stage: "applied" })).toEqual({
      requirement: null, source: "submissions", view: "list", stage: null, page: 1,
    });
    expect(parseSubmissionListParams({ requirement: REQUIREMENT, view: "board", stage: "submitted", page: "3" })).toEqual({
      requirement: REQUIREMENT, source: "submissions", view: "board", stage: "submitted", page: 3,
    });
    expect(parseSubmissionListParams({ requirement: "x" }).source).toBe("direct");
    expect(submissionPipelinePath("en", "acme-bau")).toBe("/en/org/acme-bau/applicants?source=submissions");
    expect(submissionPipelinePath("en", "acme-bau", { requirement: REQUIREMENT, view: "board", stage: "offer", page: 2 })).toBe(
      `/en/org/acme-bau/applicants?requirement=${REQUIREMENT}&view=board&stage=offer&page=2`,
    );
    expect(employerSubmissionPath("en", "acme-bau", SUBMISSION)).toBe(`/en/org/acme-bau/applicants/submissions/${SUBMISSION}`);
  });
});

describe("the reads of the pipeline", () => {
  it("pages the submitted candidates with the total and groups the board by stage in the pipeline order", async () => {
    rpcMock.mockResolvedValue({ data: [listRow("a", "submitted"), listRow("b", "offer")], error: null });
    const page = await listEmployerSubmissions(ORG.id, { requirement: REQUIREMENT, stage: null, page: 2 });
    expect(rpcMock).toHaveBeenCalledWith("list_employer_submissions", {
      p_org: ORG.id, p_requirement: REQUIREMENT, p_stage: undefined, p_limit: 50, p_offset: 50,
    });
    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.partnerName)).toEqual(["Manila Recruit", "Manila Recruit"]);
    const board = await listSubmissionBoard(ORG.id, REQUIREMENT);
    expect(board.map((column) => `${column.status}:${column.rows.length}`)).toEqual([
      "submitted:1", "viewed:0", "shortlisted:0", "interview:0", "offer:1", "hired:0", "rejected:0", "withdrawn:0",
    ]);
  });

  it("answers a submission the caller may not read with null, and keeps the history's notes", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_NOT_FOUND", null));
    expect(await getEmployerSubmission(SUBMISSION)).toBeNull();
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null });
    expect((await getEmployerSubmission(SUBMISSION))?.snapshot?.first_name).toBe("Amina");
    rpcMock.mockResolvedValueOnce({
      data: [
        { from_status: "awaiting_candidate", to_status: "submitted", actor_role: "candidate", note: null, created_at: "2026-11-02T00:00:00Z" },
        { from_status: "interview", to_status: "rejected", actor_role: "employer", note: REASON, created_at: "2026-11-04T00:00:00Z" },
      ],
      error: null,
    });
    expect(await listSubmissionEvents(SUBMISSION)).toEqual([
      { fromStatus: null, toStatus: "submitted", actorRole: "candidate", note: null, createdAt: "2026-11-02T00:00:00Z" },
      { fromStatus: "interview", toStatus: "rejected", actorRole: "employer", note: REASON, createdAt: "2026-11-04T00:00:00Z" },
    ]);
  });
});

describe("the actions of the pipeline (FR-O5 AC3, AC5, AC6, AC8, AC11)", () => {
  it("changes a stage of the organisation's own submission only", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ ...detailRow, organization_id: "another" }], error: null });
    expect(await changeSubmissionStage("acme-bau", SUBMISSION, { status: "offer", note: "" })).toEqual({
      message: "This candidate could not be found.",
    });
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect(await changeSubmissionStage("acme-bau", SUBMISSION, { status: "rejected", note: REASON })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenLastCalledWith("set_submission_status", { p_submission: SUBMISSION, p_status: "rejected", p_note: REASON });
  });

  it("says why a stage did not change", async () => {
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null }).mockResolvedValueOnce(refusal("CHARA_FEATURE_NOT_IN_PLAN", "read_only_free_plan"));
    expect(await changeSubmissionStage("acme-bau", SUBMISSION, { status: "offer", note: "" })).toEqual({
      message: "Your organization has no active paid plan, so stages cannot be changed.",
    });
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null }).mockResolvedValueOnce(refusal("CHARA_INVALID_TRANSITION", "interview to shortlisted"));
    expect((await changeSubmissionStage("acme-bau", SUBMISSION, { status: "shortlisted", note: "" })).message).toContain("already moved");
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null });
    expect(await changeSubmissionStage("acme-bau", SUBMISSION, { status: "rejected", note: "short" })).toEqual({
      errors: { note: "Enter a reason of at least 10 characters" },
    });
  });

  it("reports the moved and the skipped candidates of a bulk change", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { submission_id: "a", ok: true, error_code: null },
        { submission_id: "b", ok: false, error_code: "CHARA_INVALID_TRANSITION" },
      ],
      error: null,
    });
    const result = await bulkChangeSubmissionStage("acme-bau", {
      submissionIds: [SUBMISSION, "6d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f"],
      status: "shortlisted",
      note: "",
    });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "member", { hideFromOutsiders: true });
    expect(result.summary).toEqual({
      moved: ["a"],
      skipped: [{ id: "b", message: "Skipped: this move is not allowed from its stage, or the candidate withdrew" }],
    });
  });

  it("adds an internal note and opens only a document of the submission's share for submission_review", async () => {
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null }).mockResolvedValueOnce({ data: 7, error: null });
    expect(await addSubmissionInternalNote("acme-bau", SUBMISSION, { body: "Strong welding test result" })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenLastCalledWith("add_submission_note", { p_submission: SUBMISSION, p_body: "Strong welding test result" });

    const shared = { id: DOCUMENT, title: "Certificate", type: "certificate", file_name: "c.pdf", size_bytes: 10, expires_on: null, available: true };
    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null }).mockResolvedValueOnce({ data: [shared], error: null });
    requestLinkMock.mockResolvedValue({ url: "https://storage.example/x" });
    expect(await openSubmissionDocument("acme-bau", SUBMISSION, DOCUMENT)).toEqual({ url: "https://storage.example/x" });
    expect(requestLinkMock).toHaveBeenCalledWith(DOCUMENT, "submission_review");

    rpcMock.mockResolvedValueOnce({ data: [detailRow], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await openSubmissionDocument("acme-bau", SUBMISSION, DOCUMENT)).toEqual({ message: "This document is no longer available." });
  });
});

describe("the confirmation of a bulk move (FR-O5)", () => {
  it("says plainly which candidates are skipped", () => {
    expect(BULK_MOVE_SKIPPED).toBe("Candidates who withdrew, and candidates who cannot move to this stage from their current one, are skipped");
    expect(BULK_MOVE_SKIPPED).not.toContain("moves their stage");
  });
});
