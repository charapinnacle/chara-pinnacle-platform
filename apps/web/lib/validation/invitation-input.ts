import * as z from "zod";
import { declineFormSchema, INVITE_BATCH_MAX } from "@/lib/validation/invitation";

// Kept apart from invitation.ts, which the invitation forms load in the browser: only the server actions parse these.

export const invitationSources = ["suggestions", "directory", "profile"] as const;
export type InvitationSource = (typeof invitationSources)[number];

export const invitePartnersInputSchema = z.object({
  requirementId: z.uuid(),
  partnerIds: z
    .array(z.uuid())
    .min(1)
    .max(INVITE_BATCH_MAX)
    .refine((ids) => new Set(ids).size === ids.length),
  source: z.enum(invitationSources),
});
export type InvitePartnersInput = z.input<typeof invitePartnersInputSchema>;

export const withdrawInputSchema = z.object({ requirementId: z.uuid(), invitationId: z.uuid() });
export type WithdrawInput = z.input<typeof withdrawInputSchema>;

export const answerInputSchema = z.object({
  invitationId: z.uuid(),
  answer: z.enum(["accepted", "declined"]),
  reason: declineFormSchema.shape.reason,
});
export type AnswerInput = z.input<typeof answerInputSchema>;
