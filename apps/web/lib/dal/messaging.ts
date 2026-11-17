import "server-only";
import { MESSAGES_PAGE_SIZE, type MessageItem, type UnreadMessages } from "@/lib/messaging/thread";
import { createClient } from "@/lib/supabase/server";

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
