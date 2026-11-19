import * as z from "zod";
import { bulkSelectionSchema, employerStages } from "@/lib/validation/applicant";
import { isPipelineSubmissionStage, type PipelineSubmissionStage } from "@/lib/submissions/presentation";

// The default of the setting submission_decline_reason_min_chars, which set_submission_status enforces; the maximum is the
// database's application_status_note_max_chars, as for applications.
export const SUBMISSION_REASON_MIN_CHARS = 10;

const REASON_LENGTH = `Enter a reason of at least ${SUBMISSION_REASON_MIN_CHARS} characters`;

const stage = z.string({ error: "Choose a stage" }).pipe(z.enum(employerStages, { error: "Choose a stage" }));

// What the Server Actions of a submission's stage change parse (FR-O5 AC3): a decline carries the reason the candidate
// reads, trimmed, of at least SUBMISSION_REASON_MIN_CHARS characters.
export const submissionStageInputSchema = z
  .object({ status: stage, note: z.string().trim() })
  .refine((value) => value.status !== "rejected" || value.note.length >= SUBMISSION_REASON_MIN_CHARS, {
    path: ["note"],
    error: REASON_LENGTH,
  });

export const submissionBulkInputSchema = z
  .object({ submissionIds: bulkSelectionSchema, status: stage, note: z.string().trim() })
  .refine((value) => value.status !== "rejected" || value.note.length >= SUBMISSION_REASON_MIN_CHARS, {
    path: ["note"],
    error: REASON_LENGTH,
  });

export type SubmissionStageInput = z.input<typeof submissionStageInputSchema>;
export type SubmissionBulkInput = z.input<typeof submissionBulkInputSchema>;

// Mirrors the check of submission_notes.body.
export const SUBMISSION_NOTE_MAX_CHARS = 5000;

export const submissionNoteInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { error: "Enter a note" })
    .max(SUBMISSION_NOTE_MAX_CHARS, { error: `Note must be at most ${SUBMISSION_NOTE_MAX_CHARS} characters` }),
});

export type SubmissionNoteInput = z.input<typeof submissionNoteInputSchema>;

export type ApplicantSource = "direct" | "submissions";

// The source and the requirement of the applicants page (FR-O5 AC1, AC12): a requirement shows its submitted candidates;
// without one, "submissions" lists the submitted candidates of every requirement and anything else the direct applicants.
export type SubmissionListParams = {
  requirement: string | null;
  source: ApplicantSource;
  view: "list" | "board";
  stage: PipelineSubmissionStage | null;
  page: number;
};

export function parseSubmissionListParams(params: Record<string, unknown>): SubmissionListParams {
  const { requirement, source, view, stage, page } = params;
  const requirementId = typeof requirement === "string" && z.uuid().safeParse(requirement).success ? requirement : null;
  return {
    requirement: requirementId,
    source: requirementId || source === "submissions" ? "submissions" : "direct",
    view: requirementId && view === "board" ? "board" : "list",
    stage: isPipelineSubmissionStage(stage) ? stage : null,
    page: typeof page === "string" && /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1,
  };
}
