import type { Database } from "@chara-pinnacle/db-types";
import { formatDate } from "@/lib/i18n/format";

export type ConnectionKind = Database["public"]["Enums"]["connection_kind"];
export type ConnectionStatus = Database["public"]["Enums"]["connection_status"];

// One connection of a conversation as list_conversation_connections answers it (FR-P2, V71).
export type ConversationConnection = {
  id: string;
  messageId: string | null;
  kind: ConnectionKind;
  status: ConnectionStatus;
  sentByMe: boolean;
  jobId: string | null;
  jobTitle: string | null;
  jobPlace: string | null;
  jobOpen: boolean;
  requirementTitle: string | null;
  occupation: string | null;
  quantity: number | null;
  destination: string | null;
  startDate: string | null;
};

export const connectionKindLabels: Record<ConnectionKind, string> = {
  inquiry: "Inquiry",
  request_workforce: "Workforce request",
  invite_to_job: "Invitation to apply",
  submit_candidate: "Candidate submission",
};

// The cue next to the chip text, so a status never rests on colour alone (NFR-U3).
export type StatusCue = "waiting" | "replied" | "done" | "declined";

function statusChip(kind: ConnectionKind, status: ConnectionStatus): { text: string; cue: StatusCue } {
  if (status === "sent") return { text: kind === "invite_to_job" ? "Not applied yet" : "Waiting for an answer", cue: "waiting" };
  if (status === "answered") return { text: "Answered", cue: "replied" };
  if (status === "declined") return { text: "Declined", cue: "declined" };
  if (kind === "invite_to_job") return { text: "Applied", cue: "done" };
  if (kind === "request_workforce") return { text: "Responded", cue: "done" };
  return { text: "Accepted", cue: "done" };
}

export type TypedMessageAction = { type: "apply"; jobId: string; label: string } | { type: "decline"; label: string };

export type TypedMessageCard =
  | { kind: "text" }
  | {
      kind: ConnectionKind;
      connectionId: string;
      label: string;
      chip: { text: string; cue: StatusCue };
      details: string[];
      // What the reader may do now (NFR-U4), or why nothing.
      actions: TypedMessageAction[];
      note: string | null;
    };

const NO_LONGER_OPEN = "This vacancy is no longer accepting applications";

// The card of a typed message (FR-P2 AC10): its fixed label, the status chip with a cue, what it is about and the reader's
// next action. Apply is the worker's only, on an invitation still waiting while the vacancy takes applications; the
// receiving side may decline what waits for its answer. A message of an unknown kind, or whose connection the reader
// cannot see, is a plain text message without actions.
export function typedMessageCard(
  messageKind: string,
  connection: ConversationConnection | undefined,
  reader: "worker" | "organization",
): TypedMessageCard {
  if (!connection || messageKind !== connection.kind || !Object.hasOwn(connectionKindLabels, messageKind)) return { kind: "text" };
  const { kind, status, sentByMe } = connection;
  const waiting = status === "sent";
  const actions: TypedMessageAction[] = [];
  let note: string | null = null;
  if (kind === "invite_to_job" && reader === "worker" && waiting) {
    if (connection.jobOpen && connection.jobId) {
      actions.push({ type: "apply", jobId: connection.jobId, label: `Apply to ${connection.jobTitle ?? "this vacancy"}` });
    } else {
      note = NO_LONGER_OPEN;
    }
  } else if (kind === "invite_to_job" && waiting && !connection.jobOpen) {
    note = NO_LONGER_OPEN;
  }
  if (waiting && !sentByMe && (kind !== "invite_to_job" || reader === "worker")) {
    actions.push({ type: "decline", label: `Decline the ${connectionKindLabels[kind].toLowerCase()}` });
  }
  return {
    kind,
    connectionId: connection.id,
    label: connectionKindLabels[kind],
    chip: statusChip(kind, status),
    details: cardDetails(connection),
    actions,
    note,
  };
}

function cardDetails(connection: ConversationConnection): string[] {
  if (connection.kind === "invite_to_job") {
    return [connection.jobTitle, connection.jobPlace].filter((value): value is string => Boolean(value));
  }
  if (connection.kind === "request_workforce") {
    return [
      connection.occupation && connection.quantity ? `${connection.quantity} × ${connection.occupation}` : connection.occupation,
      connection.destination,
      connection.startDate ? `From ${formatDate(connection.startDate)}` : null,
    ].filter((value): value is string => Boolean(value));
  }
  return [];
}
