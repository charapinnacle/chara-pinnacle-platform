"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { formatDateTime } from "@/lib/i18n/format";
import { contextLabels, counterpartLabel, type ConversationSummary } from "@/lib/messaging/present";
import type { UnreadMessages } from "@/lib/messaging/thread";
import { useUnreadMessages } from "@/lib/messaging/unread";
import { cn } from "@/lib/utils";

type ConversationListProps = {
  userId: string;
  // The side the inbox lists: the organisation, or null for the candidate's own conversations.
  side: string | null;
  items: (ConversationSummary & { href: string })[];
  initialUnread: UnreadMessages[];
};

function unreadSignature(counts: UnreadMessages[], side: string | null): string {
  return counts
    .filter((count) => count.organizationId === side)
    .map((count) => `${count.conversationId}:${count.unread}`)
    .join(",");
}

// The conversations of one inbox (FR-P1 AC10), latest message first, with the unread count of each for the reader. The
// counts follow V64's unread signal (or its poll while the channel is not connected); when the side's counts change, a
// message arrived or the reader read one elsewhere, and the page is read again so the order and the newest conversations
// are the server's.
export function ConversationList({ userId, side, items, initialUnread }: ConversationListProps) {
  const router = useRouter();
  const { counts } = useUnreadMessages(userId, initialUnread);
  const signature = unreadSignature(counts, side);
  const shown = useRef(signature);

  useEffect(() => {
    if (shown.current === signature) return;
    shown.current = signature;
    router.refresh();
  }, [router, signature]);

  const unreadOf = (id: string) => counts.find((count) => count.conversationId === id && count.organizationId === side)?.unread ?? 0;

  return (
    <ul className="grid gap-3" aria-label="Conversations">
      {items.map((item) => {
        const unread = unreadOf(item.id);
        const name = counterpartLabel(item);
        return (
          <li key={item.id} className={cn("grid gap-1 rounded-xl border bg-card p-card-sm", unread > 0 && "border-foreground/30 bg-accent/40")}>
            <p className="flex flex-wrap items-center gap-x-2 text-small text-muted-foreground">
              <span>{contextLabels[item.contextType]}</span>
              <span aria-hidden>·</span>
              <time dateTime={item.lastMessageAt}>{formatDateTime(item.lastMessageAt)}</time>
              {item.readOnlyReason ? (
                <>
                  <span aria-hidden>·</span>
                  <span>Closed for new messages</span>
                </>
              ) : null}
            </p>
            <p className={cn("text-body wrap-anywhere", unread > 0 ? "font-semibold" : "font-medium")}>
              <Link
                href={item.href}
                // One label: a visually hidden span is a separate box, so the name would read "Name , 1 unread".
                aria-label={unread > 0 ? `${name}, ${unread} unread` : undefined}
                className="rounded-sm underline decoration-transparent decoration-[1.5px] underline-offset-4 transition-colors duration-150 hover:decoration-foreground focus-visible:decoration-foreground"
              >
                {name}
              </Link>
            </p>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              {item.contextTitle ? <p className="text-small text-muted-foreground wrap-anywhere">{item.contextTitle}</p> : null}
              {unread > 0 ? (
                <p aria-hidden className="rounded-full bg-foreground px-2 py-0.5 text-caption font-semibold text-background">
                  {unread} unread
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
