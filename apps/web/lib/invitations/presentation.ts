import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";
import type { StatusTone } from "@/lib/status-tone";

export type InvitationStatus = Database["public"]["Enums"]["invitation_status"];

export const invitationStatuses = [
  "invited",
  "viewed",
  "accepted",
  "declined",
  "responded",
  "withdrawn",
  "expired",
] as const satisfies readonly InvitationStatus[];

// What the employer reads per partner (FR-O1 AC9): a viewed invitation is still unanswered, so it reads as invited.
export const employerStatusLabels: Record<InvitationStatus, string> = {
  invited: "Invited",
  viewed: "Invited (seen)",
  accepted: "Accepted",
  declined: "Declined",
  responded: "Responded",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

// What the invited partner reads: whether it still has to answer, and what happened otherwise (NFR-U4).
export const partnerStatusLabels: Record<InvitationStatus, string> = {
  invited: "New",
  viewed: "Not answered",
  accepted: "Accepted",
  declined: "Declined",
  responded: "Responded",
  withdrawn: "Withdrawn by the employer",
  expired: "Expired",
};

export const invitationTones: Record<InvitationStatus, StatusTone> = {
  invited: "info",
  viewed: "info",
  accepted: "success",
  declined: "neutral",
  responded: "success",
  withdrawn: "neutral",
  expired: "neutral",
};

// The moves of withdraw_invitation and answer_invitation, and the states in which get_invitation returns every field.
export function canWithdraw(status: InvitationStatus): boolean {
  return status === "invited" || status === "viewed" || status === "accepted";
}

export function canAnswer(status: InvitationStatus): boolean {
  return status === "invited" || status === "viewed";
}

export function isFullInvitation(status: InvitationStatus): boolean {
  return status === "invited" || status === "viewed" || status === "accepted" || status === "responded";
}

// The partner's next step on its invitation page (NFR-U4).
export const partnerNextSteps: Record<InvitationStatus, string> = {
  invited: "Read the requirement, then accept or decline the invitation. The employer sees your answer.",
  viewed: "Read the requirement, then accept or decline the invitation. The employer sees your answer.",
  accepted: "You accepted this invitation and the employer can see that. Send your response with your proposal.",
  declined: "You declined this invitation. The employer can see your answer and your reason.",
  responded: "You responded to this invitation. Open your response to read, change or withdraw it.",
  withdrawn: "The employer withdrew this invitation, so it can no longer be answered.",
  expired: "The requirement closed before the invitation was answered, so it expired.",
};

export const invitationSourceLabels: Record<"suggestions" | "directory" | "profile" | "saved", string> = {
  suggestions: "Invited from the suggestions",
  directory: "Invited from the directory",
  profile: "Invited from the partner profile",
  saved: "Invited from your saved partners",
};

// The allowance of one requirement (requirement_invitation_usage): limit is null when the plan has none, applies whether
// it is enforced for the employer.
export type InvitationUsage = { used: number; limit: number | null; applies: boolean; planName: string | null };

// "5 of 10 invitations used" (FR-O1 AC9, AC12); without a limit that applies, the number sent.
export function invitationUsageText({ used, limit, applies }: InvitationUsage): string {
  if (applies && limit !== null) return `${formatCount(used)} of ${formatCount(limit)} ${limit === 1 ? "invitation" : "invitations"} used`;
  return `${formatCount(used)} ${used === 1 ? "invitation" : "invitations"} sent`;
}

export function atInvitationLimit({ used, limit, applies }: InvitationUsage): boolean {
  return applies && limit !== null && used >= limit;
}

export function selectedText(count: number): string {
  return `${formatCount(count)} selected`;
}

const listFormat = new Intl.ListFormat("en-GB", { type: "conjunction" });

// One partner of a call of invite_partners as the page shows it.
export type InviteOutcome = { partnerId: string; name: string; status: InvitationStatus; alreadyInvited: boolean };

// The confirmation after inviting (FR-O1 AC12): the partners invited now, and each partner that already had an
// invitation with its real status, never "Invited" for one that was withdrawn, declined or expired (V41 note).
export function inviteConfirmation(outcomes: readonly InviteOutcome[]): { sent: string | null; already: string[] } {
  const sent = outcomes.filter((outcome) => !outcome.alreadyInvited).map((outcome) => outcome.name);
  return {
    sent: sent.length === 0 ? null : `${sent.length === 1 ? "Invitation" : "Invitations"} sent to ${listFormat.format(sent)}.`,
    already: outcomes
      .filter((outcome) => outcome.alreadyInvited)
      .map((outcome) => `${outcome.name} already has an invitation to this requirement: ${employerStatusLabels[outcome.status]}.`),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type InboxParams = { status: InvitationStatus | null; cursor: string | null };

// The status filter and the page of the partner's inbox from its address; a value that does not parse is left out.
export function parseInboxParams(raw: Record<string, string | string[] | undefined>): InboxParams {
  const status = invitationStatuses.find((value) => value === raw.status) ?? null;
  const cursor = typeof raw.cursor === "string" && UUID.test(raw.cursor) ? raw.cursor : null;
  return { status, cursor };
}

export function inboxQuery({ status, cursor }: InboxParams): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function inboxCountText(count: number, more: boolean): string {
  return `${formatCount(count)} ${count === 1 ? "invitation" : "invitations"} shown${more ? ", more on the next page" : ""}`;
}
