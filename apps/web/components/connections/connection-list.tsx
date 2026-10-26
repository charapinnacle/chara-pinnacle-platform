"use client";

import { Bell, Bookmark } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { Card, CardFooter } from "@/components/layout/card";
import { setFollowing, setSavedPartner } from "@/lib/actions/connections";
import type { ConnectionItem } from "@/lib/connections/list";
import { formatDate } from "@/lib/i18n/format";

type Mode = { kind: "saved"; organizationId: string } | { kind: "following" };

type ConnectionListProps = {
  mode: Mode;
  items: ConnectionItem[];
  headingId: string;
  // Where the empty list leads: Find Partners for saved partners, Find Jobs or the directories for follows.
  empty: { title: string; description: string; href: string; label: string };
  nextHref: string | null;
  firstHref: string | null;
};

const TEXT = {
  saved: { remove: "Remove", at: "Saved", failure: "The partner was not removed", removed: "removed from your saved partners" },
  following: { remove: "Unfollow", at: "Followed", failure: "The company was not unfollowed", removed: "is no longer followed" },
} as const;

function ConnectionRow({ mode, item, headingId, onRemove }: { mode: Mode; item: ConnectionItem; headingId: string; onRemove: (item: ConnectionItem) => void }) {
  const text = TEXT[mode.kind];
  const { pending, run } = useActionCall(text.failure);

  function remove() {
    run(async () => {
      const result =
        mode.kind === "saved" ? await setSavedPartner(item.id, mode.organizationId, false) : await setFollowing(item.id, false);
      if (result.message) return result;
      // The row about to leave would take the focus with it.
      document.getElementById(headingId)?.focus();
      onRemove(item);
      // The polite status of the list says it once; a toast would say it a second time.
      return { silent: true };
    }, `${item.name} ${text.removed}`);
  }

  return (
    <Card as="li" className="gap-2">
      <h2 className="text-h2">
        <TextLink href={item.href} className="break-words">
          {item.name}
        </TextLink>
      </h2>
      {item.details.map((line) => (
        <p key={line} className="text-body break-words text-muted-foreground">
          {line}
        </p>
      ))}
      <p className="text-small text-muted-foreground">
        {text.at} <time dateTime={item.at}>{formatDate(item.at)}</time>
      </p>
      <CardFooter>
        <FormButton type="button" variant="secondary" className="w-auto" busy={pending} onClick={remove}>
          {text.remove}
          <span className="sr-only"> {item.name}</span>
        </FormButton>
      </CardFooter>
    </Card>
  );
}

// The saved partners of an employer or the companies a user follows (FR-L4 AC10): each row links to the profile or page
// and has Remove (Unfollow), which takes the row away once the database confirms and says so in a polite live region.
export function ConnectionList({ mode, items, headingId, empty, nextHref, firstHref }: ConnectionListProps) {
  const [removed, setRemoved] = useState<string[]>([]);
  const visible = items.filter((item) => !removed.includes(item.id));
  const [announcement, setAnnouncement] = useState("");

  function onRemove(item: ConnectionItem) {
    setRemoved((ids) => [...ids, item.id]);
    setAnnouncement(`${item.name} ${TEXT[mode.kind].removed}.`);
  }

  const Icon = mode.kind === "saved" ? Bookmark : Bell;
  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {visible.length === 0 ? (
        firstHref ? (
          <EmptyState icon={Icon} title="Nothing more on this page">
            <TextLink standalone href={firstHref}>
              Back to the first page
            </TextLink>
          </EmptyState>
        ) : (
          <EmptyState icon={Icon} title={empty.title} description={empty.description}>
            <TextLink standalone href={empty.href}>
              {empty.label}
            </TextLink>
          </EmptyState>
        )
      ) : (
        <ul className="grid gap-3">
          {visible.map((item) => (
            <ConnectionRow key={item.id} mode={mode} item={item} headingId={headingId} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-6">
        {nextHref && visible.length > 0 ? (
          <TextLink standalone href={nextHref}>
            Next page
          </TextLink>
        ) : null}
        {firstHref && visible.length > 0 ? (
          <TextLink standalone href={firstHref}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
