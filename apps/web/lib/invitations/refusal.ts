import { limitRefusalMessage } from "@/lib/billing/limits";
import { employerStatusLabels, invitationStatuses, partnerStatusLabels, type InvitationStatus } from "@/lib/invitations/presentation";

type RefusalError = { code?: string; message: string; details?: string | null };

export const INVITATION_LIMIT_KEY = "partner_invitations_per_requirement";

export const INVITATION_MESSAGES = {
  releaseOff: "Invitations cannot be changed at the moment.",
  suspended: "This organization is suspended, so its invitations cannot be changed.",
  notAllowed: "You are not allowed to change the invitations of this company.",
  notFound: "This invitation or requirement could not be found. Reload the page.",
  notOpen: "Partners can be invited to an open requirement only. Reload the page.",
  unavailable: "A partner you chose can no longer be invited, so nobody was invited. Reload the page and choose again.",
  tooMany: "Choose 1 to 25 different partners.",
  dailyCap: "Your company has sent the most partner invitations allowed in 24 hours, so nobody was invited. Try again tomorrow.",
  tooManyChanges: "Too many changes were made today. Try again tomorrow.",
  reason: "Write at most 500 characters, without special characters.",
} as const;

// A refusal of invite_partners: the plan's limit for the requirement, which the page answers with the upgrade prompt
// (V13); a message (the daily cap applies whatever the plan, so it gets no upgrade prompt); or a fault the caller logs.
// No SQL text or detail of an unexpected error reaches the screen, and partner_unavailable never says which partner.
export type InviteRefusal = { kind: "limit" } | { kind: "message"; message: string } | { kind: "fault" };

function statusOf(detail: string | null | undefined): InvitationStatus | undefined {
  return invitationStatuses.find((status) => status === detail);
}

// The refusals every invitation function shares: who may act, the release, the organisation and the quota of audited
// writes.
function sharedRefusal(error: RefusalError): { kind: "message"; message: string } | null {
  if (error.message === "CHARA_FORBIDDEN") {
    if (error.details === "release_off") return { kind: "message", message: INVITATION_MESSAGES.releaseOff };
    if (error.details === "organization_suspended") return { kind: "message", message: INVITATION_MESSAGES.suspended };
    return { kind: "message", message: INVITATION_MESSAGES.notAllowed };
  }
  if (error.code === "42501") return { kind: "message", message: INVITATION_MESSAGES.notAllowed };
  if (error.message === "CHARA_NOT_FOUND" || error.code === "P0002") return { kind: "message", message: INVITATION_MESSAGES.notFound };
  if (error.message === "CHARA_RATE_LIMITED") return { kind: "message", message: INVITATION_MESSAGES.tooManyChanges };
  return null;
}

export function inviteRefusal(error: RefusalError): InviteRefusal {
  if (error.message === "CHARA_LIMIT_REACHED") {
    return error.details === INVITATION_LIMIT_KEY ? { kind: "limit" } : { kind: "message", message: limitRefusalMessage(error.details, "employer") };
  }
  if (error.message === "CHARA_RATE_LIMITED" && error.details === "partner_invitations_per_day") {
    return { kind: "message", message: INVITATION_MESSAGES.dailyCap };
  }
  if (error.message === "CHARA_INVALID_INPUT") {
    if (error.details === "partner_unavailable") return { kind: "message", message: INVITATION_MESSAGES.unavailable };
    if (error.details === "p_partners") return { kind: "message", message: INVITATION_MESSAGES.tooMany };
    return { kind: "fault" };
  }
  if (error.message === "CHARA_INVALID_STATE") return { kind: "message", message: INVITATION_MESSAGES.notOpen };
  return sharedRefusal(error) ?? { kind: "fault" };
}

// A refusal of withdraw_invitation: an invitation that was answered, withdrawn or expired meanwhile names its status.
export function withdrawRefusal(error: RefusalError): { kind: "message"; message: string } | { kind: "fault" } {
  if (error.message === "CHARA_INVALID_STATE") {
    const status = statusOf(error.details);
    return {
      kind: "message",
      message: status
        ? `This invitation is ${employerStatusLabels[status].toLowerCase()} and can no longer be withdrawn. Reload the page.`
        : INVITATION_MESSAGES.notFound,
    };
  }
  return sharedRefusal(error) ?? { kind: "fault" };
}

// A refusal of answer_invitation: the reason (a field of the form), an invitation that is no longer open to an answer
// with its status, or a shared refusal.
export function answerRefusal(
  error: RefusalError,
): { kind: "field"; message: string } | { kind: "message"; message: string } | { kind: "fault" } {
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_reason") return { kind: "field", message: INVITATION_MESSAGES.reason };
  if (error.message === "CHARA_INVALID_STATE") {
    const status = statusOf(error.details);
    return {
      kind: "message",
      message: status
        ? `This invitation is ${partnerStatusLabels[status].toLowerCase()} and can no longer be answered. Reload the page.`
        : INVITATION_MESSAGES.notFound,
    };
  }
  return sharedRefusal(error) ?? { kind: "fault" };
}
