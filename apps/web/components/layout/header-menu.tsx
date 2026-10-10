"use client";

import { Menu, X } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

// The server render and the hydration pass see false, so without JavaScript the links stay visible and the button,
// which would do nothing, stays hidden.
export function HeaderMenu({ children }: { children: React.ReactNode }) {
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
    <div className="contents md:flex md:items-center" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "-me-2 ms-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-small font-medium hover:bg-accent md:hidden",
          !interactive && "hidden",
        )}
      >
        <Icon aria-hidden className="size-5" />
        Menu
      </button>
      <div
        id={panelId}
        onClick={onPanelClick}
        className={cn("order-last basis-full pb-3 md:order-none md:block md:basis-auto md:pb-0", interactive && !open && "hidden")}
      >
        {children}
      </div>
    </div>
  );
}
