"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchLatestMessages, fetchUnreadMessageCounts } from "@/lib/actions/messaging";
import { followLive, subscribeConversation, subscribeUnreadMessages } from "@/lib/messaging/live";
import {
  mergeLatest,
  mergeMessages,
  THREAD_POLL_MS,
  totalUnread,
  UNREAD_MESSAGES_POLL_MS,
  type MessageItem,
  type UnreadMessages,
} from "@/lib/messaging/thread";

export const MESSAGES_READ_EVENT = "chara:messages-read";

// Tells the badge that the page read a conversation, for when its channel is not connected.
export function announceMessagesRead(): void {
  window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
}

// The messages of an open thread: the page's own first page, then the newest page after each Realtime signal, or every
// THREAD_POLL_MS while the channel is not connected (FR-P1 AC8, NFR-P4). add merges messages the page itself got, a sent
// message or an older page.
export function useConversationMessages(conversationId: string, initial: MessageItem[]) {
  const [messages, setMessages] = useState(initial);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    const page = await fetchLatestMessages(conversationId);
    if (page) setMessages((current) => mergeLatest(current, page));
  }, [conversationId]);

  const add = useCallback((items: MessageItem[]) => setMessages((current) => mergeMessages(current, items)), []);

  useEffect(
    () =>
      followLive({
        subscribe: (handlers) => subscribeConversation(conversationId, handlers),
        refresh,
        pollMs: THREAD_POLL_MS,
        onConnected: setConnected,
      }),
    [conversationId, refresh],
  );

  return { messages, connected, refresh, add };
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
