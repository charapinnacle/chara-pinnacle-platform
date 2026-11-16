import * as z from "zod";
import { characters } from "@/lib/utils";
import { CONTROL_CHARACTER, LINE_BREAKS_AND_TABS, NO_CONTROL_CHARACTERS } from "@/lib/validation/job";

// The bounds of submit_candidate (FR-O4 Data and validation); the database stays the authority.
export const CANDIDATE_EMAIL_MAX = 254;
export const SUBMISSION_NOTE_MAX = 1_000;

export const CANDIDATE_EMAIL_REQUIRED = "Enter the candidate's email address.";
export const CANDIDATE_EMAIL_INVALID = "Enter a valid email address, like name@example.com.";
export const CANDIDATE_EMAIL_TOO_LONG = "The email address must have 254 characters or fewer.";
export const SUBMISSION_NOTE_TOO_LONG = "The note must have 1,000 characters or fewer.";
export const SHARE_CONSENT_REQUIRED = "Confirm that you agree to share your profile and the selected documents";

// The address is trimmed and lower-cased as submit_candidate stores it; the note is plain text, kept as typed after
// trimming.
export const submitCandidateFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: CANDIDATE_EMAIL_REQUIRED })
    .max(CANDIDATE_EMAIL_MAX, { error: CANDIDATE_EMAIL_TOO_LONG })
    .pipe(z.email({ error: CANDIDATE_EMAIL_INVALID })),
  note: z
    .string()
    .trim()
    .refine((value) => characters(value) <= SUBMISSION_NOTE_MAX, { error: SUBMISSION_NOTE_TOO_LONG })
    .refine((value) => !CONTROL_CHARACTER.test(value.replace(LINE_BREAKS_AND_TABS, "")), { error: NO_CONTROL_CHARACTERS }),
});

export type SubmitCandidateFormInput = z.input<typeof submitCandidateFormSchema>;
export type SubmitCandidateFormOutput = z.output<typeof submitCandidateFormSchema>;

// The candidate's answer: none or some of their own documents (at most documentsMax, the apply limit approve_submission
// shares), and the consent to the sharing notice for this submission (NFR-C4).
export function approveFormSchema(documentsMax: number) {
  return z.object({
    documentIds: z
      .array(z.uuid())
      .transform((ids) => [...new Set(ids)])
      .refine((ids) => ids.length <= documentsMax, { error: `Select at most ${documentsMax} documents` }),
    consent: z.boolean({ error: SHARE_CONSENT_REQUIRED }).refine(Boolean, { error: SHARE_CONSENT_REQUIRED }),
  });
}

export type ApproveFormInput = z.input<ReturnType<typeof approveFormSchema>>;
export type ApproveFormOutput = z.output<ReturnType<typeof approveFormSchema>>;
