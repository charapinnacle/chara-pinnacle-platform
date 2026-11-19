"use client";

import { Bell, BellRing, Bookmark, BookmarkCheck } from "lucide-react";
import { useOptimistic, useState } from "react";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { setFollowing, setSavedPartner } from "@/lib/actions/connections";

type ConnectionToggleProps = { name: string; active: boolean } & (
  | { kind: "save"; partnerId: string; organizationId: string }
  | { kind: "follow"; organizationId: string }
);

const TEXT = {
  save: {
    on: "Saved",
    off: "Save partner",
    failure: "Your saved partners were not changed",
    added: (name: string) => `${name} saved`,
    removed: (name: string) => `${name} removed from your saved partners`,
    icons: [Bookmark, BookmarkCheck],
  },
  follow: {
    on: "Following",
    off: "Follow",
    failure: "Your followed companies were not changed",
    added: (name: string) => `You follow ${name}`,
    removed: (name: string) => `You no longer follow ${name}`,
    icons: [Bell, BellRing],
  },
} as const;

// Save partner and Follow (FR-L4 AC9): a toggle button whose pressed state and label change at once, and go back with a
// toast when the database refuses or the request fails. Not disabled while a call runs, so a keyboard user keeps the
// focus; a press that arrives meanwhile is ignored.
export function ConnectionToggle(props: ConnectionToggleProps) {
  const { kind, name } = props;
  const text = TEXT[kind];
  const [active, setActive] = useState(props.active);
  const [shown, show] = useOptimistic(active);
  const { pending, run } = useActionCall(text.failure);

  function toggle() {
    if (pending) return;
    const next = !active;
    run(async () => {
      show(next);
      const result =
        props.kind === "save"
          ? await setSavedPartner(props.partnerId, props.organizationId, next)
          : await setFollowing(props.organizationId, next);
      if (!result.message) setActive(next);
      return result;
    }, next ? text.added(name) : text.removed(name));
  }

  const label = shown ? text.on : text.off;
  const Icon = text.icons[shown ? 1 : 0];
  return (
    <FormButton
      type="button"
      variant="secondary"
      className="w-auto"
      aria-busy={pending || undefined}
      aria-pressed={shown}
      aria-label={`${label}: ${name}`}
      onClick={toggle}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </FormButton>
  );
}
