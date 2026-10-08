import { z } from "zod";

export const employerStages = ["shortlisted", "interview", "offer", "hired", "rejected"] as const;

const stage = z.string({ error: "Choose a stage" }).pipe(z.enum(employerStages, { error: "Choose a stage" }));

// The wording of the decline reasons is fixed text of the application, not user data (FR-E2, FR-E3): the candidate sees it
// in the journey tracker. The wording is reviewed with legal, as all text the candidate reads.
const declineReasonTexts = {
  position_filled: "Position filled",
  qualifications_not_matching: "Qualifications do not match the requirements of this role",
} as const;

export const declineReasonOptions = [
  ...Object.entries(declineReasonTexts).map(([value, label]) => ({ value, label })),
  { value: "other", label: "Other" },
] as const;

const DECLINE_REASON_REQUIRED = "Enter a reason";

// What the Server Action parses: the length of the note is the setting of the database, which set_application_status
// enforces, so the action does not repeat the number. A decline carries a reason, which is its note (1 to 1000
// characters, visible to the candidate).
export const stageChangeInputSchema = z
  .object({ status: stage, note: z.string().trim() })
  .refine((value) => value.status !== "rejected" || value.note !== "", { path: ["note"], error: DECLINE_REASON_REQUIRED });

// The form offers the templates for a decline and turns the choice into the note; the limit it quotes is the database's.
// The note field is shown, and its length checked, only when its text is what is sent: not for a decline by template.
export function stageChangeFormSchema(noteMaxChars: number) {
  return z
    .object({ status: stage, reason: z.string(), note: z.string().trim() })
    .superRefine((value, context) => {
      const template = value.status === "rejected" && value.reason !== "other";
      if (template && !Object.hasOwn(declineReasonTexts, value.reason)) {
        context.addIssue({ code: "custom", path: ["reason"], message: "Choose a reason" });
      } else if (value.status === "rejected" && !template && value.note === "") {
        context.addIssue({ code: "custom", path: ["note"], message: DECLINE_REASON_REQUIRED });
      }
      if (!template && value.note.length > noteMaxChars) {
        context.addIssue({ code: "custom", path: ["note"], message: `Note must be at most ${noteMaxChars} characters` });
      }
    })
    .transform(({ status, reason, note }) => ({
      status,
      reason,
      note: status === "rejected" && reason !== "other" ? declineReasonTexts[reason as keyof typeof declineReasonTexts] : note,
    }));
}

const BULK_MAX = 100;

const SELECTION_RANGE = `Select between 1 and ${BULK_MAX} applicants`;

export const bulkSelectionSchema = z
  .array(z.uuid(), { error: SELECTION_RANGE })
  .min(1, { error: SELECTION_RANGE })
  .max(BULK_MAX, { error: SELECTION_RANGE });

// What the Server Action of a bulk change parses: the target and the reason of one change, for up to 100 applications.
export const bulkActionInputSchema = z
  .object({ applicationIds: bulkSelectionSchema, status: stage, note: z.string().trim() })
  .refine((value) => value.status !== "rejected" || value.note !== "", { path: ["note"], error: DECLINE_REASON_REQUIRED });

export type StageChangeInput = z.input<typeof stageChangeInputSchema>;
export type StageChangeFormValues = z.input<ReturnType<typeof stageChangeFormSchema>>;
export type StageChangeFormOutput = z.output<ReturnType<typeof stageChangeFormSchema>>;
export type BulkActionInput = z.input<typeof bulkActionInputSchema>;

// Mirrors the check of application_notes.body. A note is plain text: it is stored and shown as typed.
export const NOTE_MAX_CHARS = 2000;

export const noteInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { error: "Enter a note" })
    .max(NOTE_MAX_CHARS, { error: `Note must be at most ${NOTE_MAX_CHARS} characters` }),
});

export type NoteInput = z.input<typeof noteInputSchema>;
