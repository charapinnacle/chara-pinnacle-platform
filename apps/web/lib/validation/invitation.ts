import * as z from "zod";

// The partners one call of invite_partners takes at most (the database refuses more with CHARA_INVALID_INPUT p_partners).
export const INVITE_BATCH_MAX = 25;

export const DECLINE_REASON_MAX = 500;

// The rule of answer_invitation for a decline reason: trimmed, up to 500 characters, no control characters except line
// breaks and tabs; empty is none.
const CONTROL_CHARACTERS = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const declineFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(DECLINE_REASON_MAX, `Write at most ${DECLINE_REASON_MAX} characters.`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), "Remove the special characters from the reason."),
});

export type DeclineFormInput = z.input<typeof declineFormSchema>;
export type DeclineFormOutput = z.output<typeof declineFormSchema>;

// Invite one partner from its profile or the saved partners: the open requirement it is invited to.
export const inviteToRequirementSchema = z.object({
  requirement: z.string().min(1, "Choose a requirement."),
});

export type InviteToRequirementInput = z.input<typeof inviteToRequirementSchema>;

// Invite the partners selected on the suggestions page (FR-M3 AC7).
export const inviteSelectionSchema = z.object({
  partners: z
    .array(z.string())
    .min(1, "Select at least one partner to invite.")
    .max(INVITE_BATCH_MAX, `Select at most ${INVITE_BATCH_MAX} partners at a time.`),
});

export type InviteSelectionInput = z.input<typeof inviteSelectionSchema>;
