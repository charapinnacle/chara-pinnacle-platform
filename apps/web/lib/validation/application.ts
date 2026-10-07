import { z } from "zod";

export type ApplyLimits = { coverNoteMaxChars: number; documentsMax: number };

export const CONSENT_REQUIRED = "Confirm that you agree to share the selected documents";

// The form and the Server Action parse with this schema. The limits are the settings of the database, so the text the
// form quotes is the limit apply_to_job enforces. The note is plain text, kept as typed after trimming.
export function applyFormSchema({ coverNoteMaxChars, documentsMax }: ApplyLimits) {
  return z.object({
    coverNote: z
      .string()
      .trim()
      .max(coverNoteMaxChars, { error: `Cover note must be at most ${coverNoteMaxChars} characters` }),
    documentIds: z
      .array(z.uuid())
      .transform((ids) => [...new Set(ids)])
      .refine((ids) => ids.length <= documentsMax, { error: `Select at most ${documentsMax} documents` }),
    consent: z.boolean({ error: CONSENT_REQUIRED }).refine(Boolean, { error: CONSENT_REQUIRED }),
  });
}

// What the Server Action sends on: a note that is empty after trimming is no note.
export function applyInputSchema(limits: ApplyLimits) {
  return applyFormSchema(limits).transform(({ coverNote, documentIds }) => ({
    coverNote: coverNote === "" ? null : coverNote,
    documentIds,
  }));
}

export type ApplyFormInput = z.input<ReturnType<typeof applyFormSchema>>;
