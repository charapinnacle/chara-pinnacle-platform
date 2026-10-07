import { z } from "zod";

export const employerStages = ["shortlisted", "interview", "offer", "hired", "rejected"] as const;

const stage = z.string({ error: "Choose a stage" }).pipe(z.enum(employerStages, { error: "Choose a stage" }));

// What the Server Action parses: the length of the note is the setting of the database, which set_application_status
// enforces, so the action does not repeat the number.
export const stageChangeInputSchema = z.object({ status: stage, note: z.string().trim() });

// The form quotes the limit the database enforces.
export function stageChangeFormSchema(noteMaxChars: number) {
  return stageChangeInputSchema.extend({
    note: z.string().trim().max(noteMaxChars, { error: `Note must be at most ${noteMaxChars} characters` }),
  });
}

export type StageChangeFormInput = z.input<typeof stageChangeInputSchema>;
export type StageChangeFormOutput = z.output<typeof stageChangeInputSchema>;
