"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchConversationConnections, fetchLatestMessages } from "@/lib/actions/messaging";
import type { ConversationConnection } from "@/lib/connections/typed-messages";
import { followLive, subscribeConversation } from "@/lib/messaging/live";
import { mergeLatest, mergeMessages, THREAD_POLL_MS, type MessageItem } from "@/lib/messaging/thread";

// The messages of an open thread: the page's own first page, then the newest page after each Realtime signal, or every
// THREAD_POLL_MS while the channel is not connected (FR-P1 AC8, NFR-P4). add merges messages the page itself got, a sent
// message or an older page. The connections of its typed messages are read again with each newest page; a new render of
// the page (router.refresh) brings its own.
export function useConversationMessages(
  conversationId: string,
  initial: MessageItem[],
  pageConnections: Record<string, ConversationConnection>,
) {
  const [messages, setMessages] = useState(initial);
  const [connected, setConnected] = useState(false);
  const [connections, setConnections] = useState({ page: pageConnections, latest: pageConnections });
  if (connections.page !== pageConnections) setConnections({ page: pageConnections, latest: pageConnections });

  const refresh = useCallback(async () => {
    const [page, latest] = await Promise.all([fetchLatestMessages(conversationId), fetchConversationConnections(conversationId)]);
    if (page) setMessages((current) => mergeLatest(current, page));
    if (latest) setConnections((current) => ({ ...current, latest }));
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

  return { messages, connections: connections.latest, connected, refresh, add };
}
