"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import type { UnreadMessages } from "@/lib/messaging/thread";
import { messagesLabel, useUnreadMessages } from "@/lib/messaging/unread";
import { badgeText } from "@/lib/notifications/bell";

export type MessagesBadgeProps = {
  href: string;
  userId: string;
  initial: UnreadMessages[];
  // The side the link opens: the organisation's conversations, or the candidate's own (null).
  organizationId: string | null;
};

// The unread messages of the inbox the link opens (FR-P4 AC1): the counts come with the page, then after each signal on
// the user's channel, or every 15 s while it is not connected (V64's useUnreadMessages).
export function MessagesBadge({ href, userId, initial, organizationId }: MessagesBadgeProps) {
  const { counts } = useUnreadMessages(userId, initial);
  const unread = counts.reduce((sum, count) => (count.organizationId === organizationId ? sum + count.unread : sum), 0);

  return (
    <Link
      href={href}
      aria-label={messagesLabel(unread)}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-accent"
    >
      <MessageSquare aria-hidden className="size-5" />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute end-0.5 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-caption leading-none font-semibold text-primary-foreground tabular-nums"
        >
          {badgeText(unread)}
        </span>
      ) : null}
    </Link>
  );
}
