"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchLatestMessages } from "@/lib/actions/messaging";
import { followLive, subscribeConversation } from "@/lib/messaging/live";
import { mergeLatest, mergeMessages, THREAD_POLL_MS, type MessageItem } from "@/lib/messaging/thread";

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
