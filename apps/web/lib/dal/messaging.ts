import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { parseReadOnlyReason, type ConversationSummary } from "@/lib/messaging/present";
import { MESSAGES_PAGE_SIZE, type MessageItem, type UnreadMessages } from "@/lib/messaging/thread";
import { createClient } from "@/lib/supabase/server";
import type { PageContext } from "@/lib/validation/messaging";

export type MessagesBefore = { at: string; id: string };

// A page of the thread, newest first, before the message `before` when given; the participant check and the release
// switch are list_messages'.
export async function listMessages(conversationId: string, before?: MessagesBefore): Promise<MessageItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_messages", {
    p_conversation: conversationId,
    p_before_at: before?.at,
    p_before_id: before?.id,
    p_limit: MESSAGES_PAGE_SIZE,
  });
  if (error) throw new Error("The messages could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    mine: row.mine,
    senderKind: row.sender_kind === "worker" ? "worker" : "organization",
    senderName: row.sender_name ?? null,
    senderOrganizationName: row.sender_organization_name ?? null,
    senderErased: row.sender_erased,
  }));
}

// The caller's unread messages per conversation that has any (FR-P1 AC7, FR-P4 AC2).
export async function getUnreadMessageCounts(): Promise<UnreadMessages[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_unread_counts");
  if (error) throw new Error("The unread messages could not be counted", { cause: error });
  return data.map((row) => ({ conversationId: row.conversation_id, organizationId: row.organization_id ?? null, unread: row.unread }));
}

const CONVERSATIONS_PAGE_SIZE = 20;

type ConversationRow = Database["public"]["Functions"]["list_conversations"]["Returns"][number];

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    contextType: row.context_type,
    contextId: row.context_id,
    requirementId: row.requirement_id ?? null,
    counterpartKind: row.counterpart_kind === "worker" ? "worker" : "organization",
    counterpartName: row.counterpart_name ?? null,
    contextTitle: row.context_title ?? null,
    lastMessageAt: row.last_message_at,
    unread: row.unread,
    readOnlyReason: parseReadOnlyReason(row.read_only_reason ?? null),
  };
}

// A page of the inbox of the organisation organizationId, or of the candidate's own conversations when it is null, latest
// message first, of one context when given, after the conversation `before` when given (FR-P1 AC10). The membership, the
// aal and the release switch are list_conversations'.
export async function listConversations(
  organizationId: string | null,
  { context, before }: { context: PageContext | null; before: MessagesBefore | null },
): Promise<{ items: ConversationSummary[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_conversations", {
    p_org: organizationId ?? undefined,
    p_context_type: context ?? undefined,
    p_before_at: before?.at,
    p_before_id: before?.id,
    p_limit: CONVERSATIONS_PAGE_SIZE + 1,
  });
  if (error) throw new Error("The conversations could not be loaded", { cause: error });
  return { items: data.slice(0, CONVERSATIONS_PAGE_SIZE).map(toSummary), hasMore: data.length > CONVERSATIONS_PAGE_SIZE };
}

// The header of one thread from the caller's side (FR-P1 AC11), with the organisation of that side; null for a
// conversation the caller takes no part in and an unknown id, which get_conversation answers alike.
export async function getConversation(conversationId: string): Promise<(ConversationSummary & { organizationId: string | null }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_conversation", { p_conversation: conversationId });
  if (error?.message === "CHARA_FORBIDDEN" && !error.details) return null;
  if (error) throw new Error("The conversation could not be loaded", { cause: error });
  const row = data[0];
  return row ? { ...toSummary(row), organizationId: row.organization_id ?? null } : null;
}
