"use client";

import type { Database } from "@chara-pinnacle/db-types";
import { BellOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { formatDateTime, formatRelative } from "@/lib/i18n/format";
import { presentNotification, type NotificationItem } from "@/lib/notifications/present";
import { announceUnreadChanged } from "@/lib/notifications/unread-channel";
import { cn } from "@/lib/utils";

type AccountKind = Database["public"]["Enums"]["account_kind"];

const FAILURE = "The notifications were not marked as read";

type RowProps = {
  item: NotificationItem;
  read: boolean;
  lang: string;
  accountKind: AccountKind | null;
  now: Date;
  onRead: (ids: string[]) => void;
};

function NotificationRow({ item, read, lang, accountKind, now, onRead }: RowProps) {
  const { title, kindLabel, href } = presentNotification(item, { lang, accountKind });
  const { pending, run } = useActionCall(FAILURE);

  // Opening the item marks it read; the page it opens does not wait for that.
  function open() {
    if (read) return;
    onRead([item.id]);
    markNotificationsRead([item.id])
      .then((result) => {
        if (result.message) toastError(FAILURE, result.message);
        announceUnreadChanged();
      })
      .catch(() => toastNetworkError(FAILURE));
  }

  function markRead() {
    run(async () => {
      onRead([item.id]);
      const result = await markNotificationsRead([item.id]);
      announceUnreadChanged();
      return result;
    }, "Marked as read");
  }

  return (
    <li className={cn("grid gap-1 rounded-xl border bg-card p-card-sm", !read && "border-foreground/30 bg-accent/40")}>
      <p className="flex flex-wrap items-center gap-x-2 text-small text-muted-foreground">
        <span>{kindLabel}</span>
        <span aria-hidden>·</span>
        <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
          {formatRelative(item.createdAt, now)}
        </time>
      </p>
      <p className={cn("text-body wrap-anywhere", read ? "font-normal" : "font-semibold")}>
        {read ? null : <span className="sr-only">Unread: </span>}
        {href ? (
          <Link
            href={href}
            onClick={open}
            className="rounded-sm underline decoration-transparent decoration-[1.5px] underline-offset-4 transition-colors duration-150 hover:decoration-foreground focus-visible:decoration-foreground"
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </p>
      {!href && !read ? (
        <div>
          <FormButton type="button" variant="secondary" className="w-auto" busy={pending} onClick={markRead}>
            Mark as read<span className="sr-only">: {title}</span>
          </FormButton>
        </div>
      ) : null}
    </li>
  );
}

type NotificationListProps = {
  lang: string;
  accountKind: AccountKind | null;
  items: NotificationItem[];
  // The time of the server render, so that the relative times of the server and the browser agree.
  renderedAt: string;
  nextHref: string | null;
  firstHref: string | null;
};

export function NotificationList({ lang, accountKind, items, renderedAt, nextHref, firstHref }: NotificationListProps) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set(items.filter((item) => item.readAt).map((item) => item.id)));
  const { pending, run } = useActionCall(FAILURE);
  const now = new Date(renderedAt);
  const unread = items.filter((item) => !readIds.has(item.id)).length;

  function onRead(ids: string[]) {
    setReadIds((current) => new Set([...current, ...ids]));
  }

  function markAll() {
    run(async () => {
      const result = await markNotificationsRead(null);
      if (!result.message) onRead(items.map((item) => item.id));
      announceUnreadChanged();
      return result;
    }, "All notifications marked as read");
  }

  if (items.length === 0) {
    return firstHref ? (
      <EmptyState icon={BellOff} title="No more notifications on this page">
        <TextLink standalone href={firstHref}>
          Back to the first page
        </TextLink>
      </EmptyState>
    ) : (
      <EmptyState icon={BellOff} title="No notifications yet" description="Updates about your account and your work on the platform appear here." />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-muted-foreground" aria-live="polite">
          {unread > 0 ? `${unread} unread on this page` : "Everything on this page is read"}
        </p>
        <FormButton type="button" variant="secondary" className="w-auto" busy={pending} onClick={markAll}>
          Mark all as read
        </FormButton>
      </div>
      <ul className="grid gap-3" aria-label="Notifications">
        {items.map((item) => (
          <NotificationRow key={item.id} item={item} read={readIds.has(item.id)} lang={lang} accountKind={accountKind} now={now} onRead={onRead} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextHref ? (
          <TextLink standalone href={nextHref}>
            Older notifications
          </TextLink>
        ) : null}
        {firstHref ? (
          <TextLink standalone href={firstHref}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
