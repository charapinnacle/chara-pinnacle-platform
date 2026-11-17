"use client";

import { useEffect, useState, useTransition } from "react";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { MessageComposer } from "@/components/messaging/message-composer";
import { fetchEarlierMessages, markConversationRead } from "@/lib/actions/messaging";
import { formatDateTime } from "@/lib/i18n/format";
import { announceMessagesRead, useConversationMessages } from "@/lib/messaging/hooks";
import { senderLabel } from "@/lib/messaging/present";
import { MESSAGES_PAGE_SIZE, type MessageItem } from "@/lib/messaging/thread";
import { cn } from "@/lib/utils";

type ConversationThreadProps = {
  conversationId: string;
  // The other party as the header names it.
  counterpart: string;
  initialMessages: MessageItem[];
  // The length a message may have, or null while the conversation is closed for new messages.
  maxChars: number | null;
  children?: React.ReactNode;
};

// One conversation (FR-P1 AC8 to AC10; NFR-S10, NFR-U3): the messages, oldest first, in a log region that announces what
// arrives, followed live through V64 (a Realtime signal, or a poll while the channel is not connected), marked read for
// the reader whenever a newer message shows (SOP P2-26 step Read). A body is rendered as text, so markup and addresses
// stay literal: nothing becomes an element or a link, and nothing is previewed. children replaces the composer while the
// conversation is closed.
export function ConversationThread({ conversationId, counterpart, initialMessages, maxChars, children }: ConversationThreadProps) {
  const { messages, refresh, add } = useConversationMessages(conversationId, initialMessages);
  const [hasEarlier, setHasEarlier] = useState(initialMessages.length >= MESSAGES_PAGE_SIZE);
  const [loadingEarlier, startLoadingEarlier] = useTransition();
  const newestId = messages[0]?.id;

  useEffect(() => {
    void markConversationRead(conversationId).then((marked) => {
      if (marked) announceMessagesRead();
    });
  }, [conversationId, newestId]);

  function showEarlier() {
    const oldest = messages.at(-1);
    if (!oldest) return;
    startLoadingEarlier(async () => {
      const page = await fetchEarlierMessages(conversationId, { at: oldest.createdAt, id: oldest.id });
      if (!page) {
        toastNetworkError("The earlier messages could not be loaded");
        return;
      }
      add(page);
      setHasEarlier(page.length >= MESSAGES_PAGE_SIZE);
    });
  }

  return (
    <div className="grid gap-section">
      <section aria-labelledby="thread-heading" className="grid gap-4">
        <h2 id="thread-heading" className="sr-only">
          Messages
        </h2>
        {hasEarlier ? (
          <div>
            <FormButton type="button" variant="secondary" className="w-full sm:w-auto" busy={loadingEarlier} onClick={showEarlier}>
              Show earlier messages
            </FormButton>
          </div>
        ) : null}
        <div role="log" aria-label={`Messages with ${counterpart}`} aria-live="polite" className="grid gap-3">
          {messages.length === 0 ? (
            <p className="text-body text-muted-foreground">No messages yet. Write the first one below.</p>
          ) : (
            <ol className="grid gap-3">
              {messages.toReversed().map((message) => (
                <li
                  key={message.id}
                  className={cn(
                    "grid w-full max-w-[85%] gap-1 rounded-xl border p-card-sm sm:max-w-[75%]",
                    message.mine ? "justify-self-end border-foreground/20 bg-accent/40" : "justify-self-start bg-card",
                  )}
                >
                  <p className="flex flex-wrap gap-x-2 text-small text-muted-foreground">
                    <span className="font-medium text-foreground wrap-anywhere">{senderLabel(message)}</span>
                    <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                  </p>
                  <p className="text-body whitespace-pre-wrap wrap-anywhere">{message.body}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
      {maxChars === null ? (
        children
      ) : (
        <MessageComposer conversationId={conversationId} recipient={counterpart} maxChars={maxChars} onSent={refresh} />
      )}
    </div>
  );
}
