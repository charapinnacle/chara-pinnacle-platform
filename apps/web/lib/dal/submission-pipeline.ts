import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { parseSnapshot, type ApplicantSnapshot } from "@/lib/applicants/snapshot";
import type { ApplicantNote, NoteRefusal, SharedDocument } from "@/lib/dal/applicant-review";
import type { StageRefusal } from "@/lib/dal/applicants";
import { reportQuotaRefused } from "@/lib/quota-refused";
import {
  isPipelineSubmissionStage,
  pipelineSubmissionStages,
  type PipelineSubmissionStage,
} from "@/lib/submissions/presentation";
import { createClient } from "@/lib/supabase/server";

export const SUBMISSIONS_PAGE_SIZE = 50;

// The board reads every submitted candidate of one requirement in one call, up to the function's maximum.
const BOARD_LIMIT = 500;

// A submitted candidate in the employer's pipeline (list_employer_submissions, FR-O5 AC1): never the address.
export type PipelineSubmission = {
  id: string;
  requirementId: string;
  requirementTitle: string;
  partnerName: string;
  partnerSlug: string | null;
  status: PipelineSubmissionStage;
  candidateName: string | null;
  approvedAt: string;
  stageChangedAt: string | null;
};

export type SubmissionBoardColumn = { status: PipelineSubmissionStage; rows: PipelineSubmission[] };

export type EmployerSubmission = {
  id: string;
  organizationId: string;
  requirementId: string;
  requirementTitle: string;
  partnerName: string;
  partnerSlug: string | null;
  status: PipelineSubmissionStage;
  candidateName: string | null;
  snapshot: ApplicantSnapshot | null;
  note: string | null;
  approvedAt: string;
  withdrawnAt: string | null;
  shareActive: boolean;
};

export type SubmissionEvent = {
  fromStatus: PipelineSubmissionStage | null;
  toStatus: PipelineSubmissionStage;
  actorRole: "candidate" | "employer" | "system";
  note: string | null;
  createdAt: string;
};

export type SubmissionBulkItem = { submissionId: string; ok: boolean; errorCode: string | null };

type ListRow = {
  id: string;
  requirement_id: string;
  requirement_title: string;
  partner_name: string;
  partner_slug: string | null;
  status: string;
  candidate_name: string | null;
  worker_approved_at: string;
  stage_changed_at: string | null;
  total_count: number;
};

function pipelineRow(row: ListRow): PipelineSubmission | null {
  if (!isPipelineSubmissionStage(row.status)) return null;
  return {
    id: row.id,
    requirementId: row.requirement_id,
    requirementTitle: row.requirement_title,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    status: row.status,
    candidateName: row.candidate_name ?? null,
    approvedAt: row.worker_approved_at,
    stageChangedAt: row.stage_changed_at ?? null,
  };
}

// One page of the submitted candidates of the employer, of one requirement or all, in one stage or all.
export async function listEmployerSubmissions(
  organizationId: string,
  params: { requirement: string | null; stage: PipelineSubmissionStage | null; page: number },
): Promise<{ rows: PipelineSubmission[]; total: number; page: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_employer_submissions", {
    p_org: organizationId,
    p_requirement: params.requirement ?? undefined,
    p_stage: params.stage ?? undefined,
    p_limit: SUBMISSIONS_PAGE_SIZE,
    p_offset: (params.page - 1) * SUBMISSIONS_PAGE_SIZE,
  });
  if (error) throw new Error("The submitted candidates could not be loaded", { cause: error });
  return {
    rows: data.flatMap((row) => pipelineRow(row) ?? []),
    total: data[0]?.total_count ?? 0,
    page: params.page,
  };
}

// The board of one requirement: a column per stage, in the order of the application pipeline.
export async function listSubmissionBoard(organizationId: string, requirementId: string): Promise<SubmissionBoardColumn[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_employer_submissions", {
    p_org: organizationId,
    p_requirement: requirementId,
    p_limit: BOARD_LIMIT,
  });
  if (error) throw new Error("The submitted candidates could not be loaded", { cause: error });
  const rows = data.flatMap((row) => pipelineRow(row) ?? []);
  return pipelineSubmissionStages.map((status) => ({ status, rows: rows.filter((row) => row.status === status) }));
}

// The approved submission of an employer the caller is a member of; null for anything the caller may not read.
export async function getEmployerSubmission(id: string): Promise<EmployerSubmission | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_employer_submission", { p_submission: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw new Error("The submitted candidate could not be loaded", { cause: error });
  }
  const [row] = data;
  if (!row || !isPipelineSubmissionStage(row.status)) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    requirementId: row.requirement_id,
    requirementTitle: row.requirement_title,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    status: row.status,
    candidateName: row.candidate_name ?? null,
    snapshot: row.profile_snapshot ? parseSnapshot(row.profile_snapshot) : null,
    note: row.note ?? null,
    approvedAt: row.worker_approved_at,
    withdrawnAt: row.withdrawn_at ?? null,
    shareActive: row.share_active,
  };
}

// The first open by a member is the system's move from Submitted to Viewed; a submission the caller cannot see is left
// to the page, which answers it as not found.
export async function markSubmissionViewed(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_submission_viewed", { p_submission: id });
  if (error && error.message !== "CHARA_NOT_FOUND") {
    throw new Error("The submission could not be marked as viewed", { cause: error });
  }
}

// The history with the notes the candidate reads, for the employer and for the candidate (FR-O5 AC3, AC9).
export async function listSubmissionEvents(id: string): Promise<SubmissionEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_submission_events", { p_submission: id });
  if (error) throw new Error("The history could not be loaded", { cause: error });
  return data.flatMap((row) =>
    isPipelineSubmissionStage(row.to_status)
      ? [
          {
            fromStatus: isPipelineSubmissionStage(row.from_status) ? row.from_status : null,
            toStatus: row.to_status,
            actorRole: row.actor_role as SubmissionEvent["actorRole"],
            note: row.note ?? null,
            createdAt: row.created_at,
          },
        ]
      : [],
  );
}

export async function listSubmissionDocuments(id: string): Promise<SharedDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submission_documents", { p_submission: id });
  if (error) throw new Error("The documents could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    expiresOn: row.expires_on,
    available: row.available,
  }));
}

export async function listSubmissionNotes(id: string, beforeId?: number): Promise<{ notes: ApplicantNote[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_submission_notes", { p_submission: id, p_before_id: beforeId });
  if (error) throw new Error("The notes could not be loaded", { cause: error });
  return {
    notes: data.map((row) => ({ id: row.id, authorName: row.author_name, body: row.body, createdAt: row.created_at })),
    hasMore: data.some((row) => row.has_more),
  };
}

export async function addSubmissionNote(id: string, body: string): Promise<NoteRefusal | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_submission_note", { p_submission: id, p_body: body });
  if (!error) return null;
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return "read_only_free_plan";
  if (error.message === "CHARA_NOT_FOUND") return "not_found";
  if (error.message === "CHARA_FORBIDDEN") return error.details === "organization_suspended" ? "organization_suspended" : "not_found";
  if (error.message === "CHARA_INVALID_INPUT") return "invalid";
  if (error.message === "CHARA_RATE_LIMITED") {
    reportQuotaRefused("audited_write", "note");
    return "rate_limited";
  }
  console.error("Adding a submission note failed", { code: error.code, message: error.message });
  return "failed";
}

function refusal(error: PostgrestError): StageRefusal {
  switch (error.message) {
    case "CHARA_INVALID_TRANSITION":
      return { kind: "already_moved" };
    case "CHARA_NOT_FOUND":
      return { kind: "not_found" };
    case "CHARA_FORBIDDEN":
      return error.details === "organization_suspended" ? { kind: "blocked", reason: "organization_suspended" } : { kind: "failed" };
    case "CHARA_FEATURE_NOT_IN_PLAN":
      return error.details === "shortlisting"
        ? { kind: "shortlisting_not_in_plan" }
        : { kind: "blocked", reason: "read_only_free_plan" };
    case "CHARA_INVALID_INPUT":
      return error.details === "p_note" ? { kind: "note_too_long" } : { kind: "failed" };
    default:
      console.error("Change of submission status failed", { code: error.code, message: error.message });
      return { kind: "failed" };
  }
}

type EmployerTarget = "shortlisted" | "interview" | "offer" | "hired" | "rejected";

export async function setSubmissionStatus(id: string, status: EmployerTarget, note: string): Promise<StageRefusal | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_submission_status", {
    p_submission: id,
    p_status: status,
    p_note: note === "" ? undefined : note,
  });
  return error ? refusal(error) : null;
}

// One call for up to 100 submitted candidates. The database judges each one (FR-O5 AC8) and checks the membership and the
// verification level of the employer of every id itself, so an id of another organisation is refused as unknown.
export async function bulkSetSubmissionStatus(
  ids: string[],
  status: EmployerTarget,
  note: string,
): Promise<{ items: SubmissionBulkItem[] } | { refusal: StageRefusal }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_set_submission_status", {
    p_submission_ids: [...new Set(ids)],
    p_status: status,
    p_note: note === "" ? undefined : note,
  });
  if (error) return { refusal: refusal(error) };
  return { items: data.map((item) => ({ submissionId: item.submission_id, ok: item.ok, errorCode: item.ok ? null : item.error_code })) };
}
