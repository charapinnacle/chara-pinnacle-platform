"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUnreadMessageCounts } from "@/lib/actions/messaging";
import { followLive, subscribeUnreadMessages } from "@/lib/messaging/live";
import type { UnreadMessages } from "@/lib/messaging/thread";

// What the header badge needs and nothing else, so the thread's hooks and helpers stay out of the chunk every signed-in
// page loads.

// While the Realtime channel is not connected the counts are asked every 15 s (FR-P1, the assumed polling interval).
export const UNREAD_MESSAGES_POLL_MS = 15_000;

export const MESSAGES_READ_EVENT = "chara:messages-read";

// Tells the badge that the page read a conversation, for when its channel is not connected.
export function announceMessagesRead(): void {
  window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
}

export function totalUnread(counts: UnreadMessages[]): number {
  return counts.reduce((sum, count) => sum + count.unread, 0);
}

// The accessible name of the header's messages link (FR-P4 AC1): the exact count, where the badge shows 99+ past 99.
export function messagesLabel(unread: number): string {
  return unread > 0 ? `Messages, ${unread} unread` : "Messages";
}

// The caller's unread messages per conversation and in total (FR-P4 AC1): the page's own counts, then the counts after
// each signal on the user's topic, or every UNREAD_MESSAGES_POLL_MS while the channel is not connected, and at once when
// the page announces a read.
export function useUnreadMessages(userId: string, initial: UnreadMessages[]) {
  const [counts, setCounts] = useState(initial);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    const next = await fetchUnreadMessageCounts();
    if (next) setCounts(next);
  }, []);

  useEffect(
    () =>
      followLive({
        subscribe: (handlers) => subscribeUnreadMessages(userId, handlers),
        refresh,
        pollMs: UNREAD_MESSAGES_POLL_MS,
        onConnected: setConnected,
      }),
    [userId, refresh],
  );

  useEffect(() => {
    const onRead = () => void refresh();
    window.addEventListener(MESSAGES_READ_EVENT, onRead);
    return () => window.removeEventListener(MESSAGES_READ_EVENT, onRead);
  }, [refresh]);

  return { counts, total: totalUnread(counts), connected, refresh };
}
