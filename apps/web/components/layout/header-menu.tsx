"use client";

import { Menu, X } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

// The server render and the hydration pass see false, so without JavaScript the links stay visible and the button,
// which would do nothing, stays hidden. actions stay in the bar at every width, next to the menu button below 1024 px, where the sidebar takes the links.
export function HeaderMenu({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  const interactive = useSyncExternalStore(subscribe, () => true, () => false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    button.current?.focus();
  }

  function onPanelClick(event: React.MouseEvent) {
    if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
  }

  const Icon = open ? X : Menu;
  return (
    <div className="contents lg:flex lg:items-center" onKeyDown={onKeyDown}>
      {actions ? <div className="ms-auto flex items-center lg:ms-0">{actions}</div> : null}
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "-me-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-small font-medium hover:bg-accent lg:hidden",
          actions ? "ms-1" : "ms-auto",
          !interactive && "hidden",
        )}
      >
        <Icon aria-hidden className="size-5" />
        Menu
      </button>
      <div
        id={panelId}
        onClick={onPanelClick}
        className={cn("order-last basis-full pt-1 pb-3 lg:order-none lg:block lg:basis-auto lg:pb-0", interactive && !open && "hidden")}
      >
        {children}
      </div>
    </div>
  );
}
