"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchUnreadNotificationCount } from "@/lib/actions/notifications";
import { badgeText, bellLabel, UNREAD_POLL_MS } from "@/lib/notifications/bell";
import { subscribeUnreadCount, UNREAD_CHANGED_EVENT } from "@/lib/notifications/unread-channel";
import { notificationsPath } from "@/lib/routes";

export type NotificationBellProps = { lang: string; userId: string; initialUnread: number };

// The unread count comes from the server with the page, then from the private Realtime channel; while the channel is not
// connected the bell asks the server every minute, and at once when the page says it changed the count.
export function NotificationBell({ lang, userId, initialUnread }: NotificationBellProps) {
  const [unread, setUnread] = useState(initialUnread);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let leave: (() => void) | undefined;
    let active = true;
    subscribeUnreadCount(userId, { onCount: setUnread, onConnected: setConnected })
      .then((unsubscribe) => {
        if (active) leave = unsubscribe;
        else unsubscribe();
      })
      .catch(() => setConnected(false));
    return () => {
      active = false;
      leave?.();
    };
  }, [userId]);

  useEffect(() => {
    async function refresh() {
      const count = await fetchUnreadNotificationCount();
      if (count !== null) setUnread(count);
    }
    window.addEventListener(UNREAD_CHANGED_EVENT, refresh);
    const timer = connected ? undefined : window.setInterval(refresh, UNREAD_POLL_MS);
    return () => {
      window.removeEventListener(UNREAD_CHANGED_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, [connected]);

  return (
    <Link
      href={notificationsPath(lang)}
      aria-label={bellLabel(unread)}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-accent"
    >
      <Bell aria-hidden className="size-5" />
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
