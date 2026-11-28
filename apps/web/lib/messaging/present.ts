import { FORMER_CANDIDATE } from "@/lib/applications/presentation";
import { employerLabel } from "@/lib/job-orders/presentation";
import {
  applicantPath,
  applicationPath,
  contactRequestsPath,
  employerSubmissionPath,
  invitationPath,
  orgContactRequestsPath,
  requirementPath,
  requirementResponsePath,
  responsePath,
  submissionPath,
} from "@/lib/routes";
import type { MessageItem } from "@/lib/messaging/thread";
import type { ConversationContext, PageContext } from "@/lib/validation/messaging";

// Who reads a conversation: the candidate, or a member of an employer or of a recruitment or staffing company (the
// organisation of the address).
export type MessagingViewer = { kind: "worker" } | { kind: "employer" | "partner"; slug: string };

export type ConversationSummary = {
  id: string;
  contextType: ConversationContext;
  contextId: string;
  requirementId: string | null;
  counterpartKind: "worker" | "organization";
  counterpartName: string | null;
  contextTitle: string | null;
  lastMessageAt: string;
  unread: number;
  readOnlyReason: ReadOnlyReason | null;
};

// Why nobody can send in a conversation: an organisation suspended, the context ended (V63), or a participant blocked it
// (V66).
export type ReadOnlyReason = "org_suspended" | "context_closed" | "blocked";

export const contextLabels: Record<ConversationContext, string> = {
  application: "Application",
  candidate_submission: "Submission",
  requirement_invitation: "Invitation",
  partner_response: "Response",
  contact_request: "Contact request",
  inquiry: "Inquiry",
  partner_inquiry: "Partner inquiry",
};

// The filters of the inbox, the contexts the viewer can take part in.
export function inboxContexts(viewer: MessagingViewer): readonly PageContext[] {
  if (viewer.kind === "worker") return ["application", "candidate_submission", "contact_request"];
  if (viewer.kind === "partner") return ["requirement_invitation", "partner_response", "contact_request", "inquiry", "partner_inquiry"];
  return ["application", "candidate_submission", "requirement_invitation", "partner_response", "contact_request", "inquiry"];
}

// The other party as FR-P1 AC11 names it: the candidate by name, an organisation by display name; an employer the partner
// may not know yet stays unnamed (NFR-S11).
export function counterpartLabel({ counterpartKind, counterpartName }: Pick<ConversationSummary, "counterpartKind" | "counterpartName">): string {
  return counterpartKind === "worker" ? (counterpartName ?? FORMER_CANDIDATE) : employerLabel(counterpartName);
}

// The page the conversation belongs to (SOP P2-26 step Context link), from the viewer's side; null for a context whose
// pages come with a later unit.
export function contextHref(lang: string, viewer: MessagingViewer, { contextType, contextId, requirementId }: ConversationSummary): string | null {
  if (viewer.kind === "worker") {
    if (contextType === "application") return applicationPath(lang, contextId);
    if (contextType === "candidate_submission") return submissionPath(lang, contextId);
    if (contextType === "contact_request") return contactRequestsPath(lang);
    return null;
  }
  const { slug } = viewer;
  if (contextType === "contact_request") return orgContactRequestsPath(lang, slug);
  if (viewer.kind === "partner") {
    if (contextType === "requirement_invitation") return invitationPath(lang, slug, contextId);
    if (contextType === "partner_response") return responsePath(lang, slug, contextId);
    return null;
  }
  if (contextType === "application") return applicantPath(lang, slug, contextId);
  if (contextType === "candidate_submission") return employerSubmissionPath(lang, slug, contextId);
  if (contextType === "requirement_invitation" && requirementId) return requirementPath(lang, slug, requirementId);
  if (contextType === "partner_response" && requirementId) return requirementResponsePath(lang, slug, requirementId, contextId);
  return null;
}

const contextLinkLabels: Record<ConversationContext, string> = {
  application: "Open the application",
  candidate_submission: "Open the submission",
  requirement_invitation: "Open the requirement",
  partner_response: "Open the response",
  contact_request: "Open the contact request",
  inquiry: "Open the inquiry",
  partner_inquiry: "Open the inquiry",
};

export function contextLinkLabel(viewer: MessagingViewer, contextType: ConversationContext): string {
  if (viewer.kind === "partner" && contextType === "requirement_invitation") return "Open the invitation";
  return contextLinkLabels[contextType];
}

// Why nobody can send, and what happens next (NFR-U4), from the viewer's side. A block names its blocker only to the blocker
// (FR-P3 AC8); everyone else reads that the conversation is closed.
export function readOnlyText(viewer: MessagingViewer, reason: ReadOnlyReason, blockedByMe = false): { title: string; next: string } {
  if (reason === "blocked") {
    return blockedByMe
      ? {
          title: "You blocked this conversation",
          next: "Neither side can send messages until you unblock it. The history stays here.",
        }
      : {
          title: "This conversation is closed for new messages",
          next: "A participant closed it. You can still read the history.",
        };
  }
  if (reason === "org_suspended") {
    return {
      title: "No new messages while an organisation in this conversation is suspended",
      next: "Messages can be sent again once the organisation is reinstated. The history stays here.",
    };
  }
  return viewer.kind === "worker"
    ? {
        title: "This conversation is closed for new messages",
        next: "You withdrew from this or closed your account. Apply again to talk to the employer. The history stays here.",
      }
    : {
        title: "This conversation is closed for new messages",
        next: "The candidate withdrew or closed their account. You can still read the history.",
      };
}

export function parseReadOnlyReason(value: string | null): ConversationSummary["readOnlyReason"] {
  return value === "org_suspended" || value === "context_closed" || value === "blocked" ? value : null;
}

// The cursor of the page after the one that ends with this conversation: its last message time and id, as
// list_conversations reads them.
export function conversationCursor({ lastMessageAt, id }: Pick<ConversationSummary, "lastMessageAt" | "id">): string {
  return `${lastMessageAt}|${id}`;
}

// How the thread names the sender of a message (FR-P1 AC5, AC11): "You", the candidate by name, a member with the
// organisation; "Former member" and "Deleted user" once the account is gone; an employer the partner may not know yet
// stays unnamed.
export function senderLabel({ mine, senderKind, senderName, senderOrganizationName, senderErased }: MessageItem): string {
  if (mine) return "You";
  if (senderKind === "worker") return senderErased ? "Deleted user" : (senderName ?? FORMER_CANDIDATE);
  const person = senderErased ? "Former member" : senderName;
  if (person && senderOrganizationName) return `${person}, ${senderOrganizationName}`;
  return person ?? employerLabel(senderOrganizationName);
}
