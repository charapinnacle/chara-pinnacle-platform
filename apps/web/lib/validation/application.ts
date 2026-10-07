import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { isApplicationStatus } from "@/lib/applications/presentation";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

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

// The list of the candidate's applications is addressed by ?stage= and ?page=: a value that is not one of the stored
// stages, or a page that is not a number from 1 to 999, falls back to every stage and the first page.
export function parseApplicationListParams(params: Record<string, unknown>): { stage: ApplicationStatus | null; page: number } {
  const { stage, page } = params;
  return {
    stage: isApplicationStatus(stage) ? stage : null,
    page: typeof page === "string" && /^[1-9]\d{0,2}$/.test(page) ? Number(page) : 1,
  };
}
