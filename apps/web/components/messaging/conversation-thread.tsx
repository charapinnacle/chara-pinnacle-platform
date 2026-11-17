"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { TypedMessageCard } from "@/components/connections/typed-message-card";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { MessageComposer, type ComposerOrganization } from "@/components/messaging/message-composer";
import { fetchEarlierMessages, markConversationRead } from "@/lib/actions/messaging";
import { typedMessageCard, type ConversationConnection } from "@/lib/connections/typed-messages";
import { formatDateTime } from "@/lib/i18n/format";
import { useConversationMessages } from "@/lib/messaging/hooks";
import { senderLabel } from "@/lib/messaging/present";
import { MESSAGES_PAGE_SIZE, type MessageItem } from "@/lib/messaging/thread";
import { announceMessagesRead } from "@/lib/messaging/unread";
import { appealPath, reportPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

const NO_CONNECTIONS: Record<string, ConversationConnection> = {};

type ConversationThreadProps = {
  lang: string;
  conversationId: string;
  // The other party as the header names it.
  counterpart: string;
  initialMessages: MessageItem[];
  // The length a message may have, or null while the conversation is closed for new messages.
  maxChars: number | null;
  organization: ComposerOrganization | null;
  // Shown above the composer, or above what replaces it: the "Workers never pay" notice (FR-P3 AC11).
  notice?: React.ReactNode;
  // The connections of the typed messages by message id (FR-P2, V71), and whether the reader is the worker.
  connections?: Record<string, ConversationConnection>;
  reader?: "worker" | "organization";
  children?: React.ReactNode;
};

// One conversation (FR-P1 AC8 to AC10; NFR-S10, NFR-U3): the messages, oldest first, in a log region that announces what
// arrives, followed live through V64 (a Realtime signal, or a poll while the channel is not connected), marked read for
// the reader whenever a newer message shows (SOP P2-26 step Read). A body is rendered as text, so markup and addresses
// stay literal: nothing becomes an element or a link, and nothing is previewed. Each message of someone else can be reported
// (FR-P3 AC6); a message of the reader's side hidden by moderation says so with its decision (FR-S1, V73). children replaces
// the composer while the conversation is closed.
export function ConversationThread({
  lang,
  conversationId,
  counterpart,
  initialMessages,
  maxChars,
  organization,
  notice,
  connections: pageConnections = NO_CONNECTIONS,
  reader = "organization",
  children,
}: ConversationThreadProps) {
  const { messages, connections, refresh, add } = useConversationMessages(conversationId, initialMessages, pageConnections);
  const [hasEarlier, setHasEarlier] = useState(initialMessages.length >= MESSAGES_PAGE_SIZE);
  const [loadingEarlier, startLoadingEarlier] = useTransition();
  const newestId = messages[0]?.id;
  const router = useRouter();
  const askedFor = useRef(new Set<string>());

  // A typed message that arrived live has no card yet: the page is read again once for it, which brings its connection.
  useEffect(() => {
    const missing = messages.filter((message) => message.kind !== "text" && !connections[message.id] && !askedFor.current.has(message.id));
    if (missing.length === 0) return;
    for (const message of missing) askedFor.current.add(message.id);
    router.refresh();
  }, [messages, connections, router]);

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
                  <MessageCard lang={lang} card={typedMessageCard(message.kind, connections[message.id], reader)} />
                  <p className="text-body whitespace-pre-wrap wrap-anywhere">{message.body}</p>
                  {message.hiddenBy !== null ? (
                    <p className="text-small">
                      <strong>Hidden by moderation.</strong> The other side no longer sees this message.{" "}
                      <TextLink href={appealPath(lang, message.hiddenBy)}>See the reasons and how to appeal</TextLink>
                    </p>
                  ) : message.mine ? null : (
                    <p className="text-small">
                      <TextLink href={reportPath(lang, "message", message.id)}>
                        Report<span className="sr-only"> the message of {senderLabel(message)}, {formatDateTime(message.createdAt)}</span>
                      </TextLink>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
      {notice}
      {maxChars === null ? (
        children
      ) : (
        <MessageComposer
          conversationId={conversationId}
          recipient={counterpart}
          maxChars={maxChars}
          organization={organization}
          onSent={refresh}
        />
      )}
    </div>
  );
}

function MessageCard({ lang, card }: { lang: string; card: ReturnType<typeof typedMessageCard> }) {
  return card.kind === "text" ? null : <TypedMessageCard lang={lang} card={card} />;
}
