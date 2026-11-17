// What the thread and the unread badge keep in the browser, shared by the server reads and the client hooks.

export const MESSAGES_PAGE_SIZE = 50;

// While the Realtime channel is not connected: an open thread asks every 4 s, so a message shows within the 5 s of
// NFR-P4 with the request's own time; the badge every 15 s (FR-P1, the assumed polling interval).
export const THREAD_POLL_MS = 4_000;
export const UNREAD_MESSAGES_POLL_MS = 15_000;

export type MessageItem = {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
  mine: boolean;
  senderKind: "worker" | "organization";
  senderName: string | null;
  senderOrganizationName: string | null;
  senderErased: boolean;
  // The decision that hid the message (V73), read only by the side that sent it; null while it is shown.
  hiddenBy: number | null;
};

export type UnreadMessages = { conversationId: string; organizationId: string | null; unread: number };

// Newest first, as list_messages answers. The times come from PostgREST in one offset, where comparing the text orders
// them to the microsecond, which Date.parse would cut to the millisecond.
function newestFirst(a: MessageItem, b: MessageItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// The messages of both lists once each, a message of items replacing the one of current with its id.
export function mergeMessages(current: MessageItem[], items: MessageItem[]): MessageItem[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of items) byId.set(message.id, message);
  return [...byId.values()].sort(newestFirst);
}

// Adds the newest page of the thread. A full page that does not reach the newest message held means more arrived than
// one page holds: the page replaces the list, rather than leaving a gap the reader would not see.
export function mergeLatest(current: MessageItem[], page: MessageItem[], pageSize = MESSAGES_PAGE_SIZE): MessageItem[] {
  const newestHeld = current[0];
  const oldestFetched = page.at(-1);
  if (page.length >= pageSize && newestHeld && oldestFetched && newestFirst(oldestFetched, newestHeld) < 0) {
    return [...page].sort(newestFirst);
  }
  return mergeMessages(current, page);
}

export function totalUnread(counts: UnreadMessages[]): number {
  return counts.reduce((sum, count) => sum + count.unread, 0);
}

// The accessible name of the header's messages link (FR-P4 AC1): the exact count, where the badge shows 99+ past 99.
export function messagesLabel(unread: number): string {
  return unread > 0 ? `Messages, ${unread} unread` : "Messages";
}
