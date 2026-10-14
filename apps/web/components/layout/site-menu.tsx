"use client";

import { Menu, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { BrandLink } from "@/components/layout/brand";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

const SITE_MENU_ID = "site-menu";

const controlClassName =
  "inline-flex min-h-11 items-center justify-center gap-2.5 rounded-lg border bg-card text-small font-medium transition-colors duration-150 hover:border-input";

// The menu of the public header as a side panel: a modal dialog, so the rest of the page is inert while it is open, focus
// stays inside it and Escape closes it; closed, it is not displayed, so neither the keyboard nor assistive technology
// reaches it. Without JavaScript the button and the close control are links to the panel and away from it, which shows
// the panel through :target (the server render and the hydration pass see the links).
export function SiteMenu({ homeHref, children }: { homeHref: string; children: React.ReactNode }) {
  const interactive = useSyncExternalStore(subscribe, () => true, () => false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  function show() {
    dialog.current?.showModal();
    close.current?.focus();
    setOpen(true);
  }

  function onClose() {
    setOpen(false);
    button.current?.focus();
  }

  // A press on the backdrop lands on the dialog itself, outside its box; a link of the panel opens its page.
  function onClick(event: React.MouseEvent<HTMLDialogElement>) {
    const panel = event.currentTarget;
    if (event.target instanceof Element && event.target.closest("a")) {
      panel.close();
      return;
    }
    if (event.target !== panel) return;
    const box = panel.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) panel.close();
  }

  const label = (
    <>
      <Menu aria-hidden className="size-4" />
      <span className="max-md:sr-only">Menu</span>
    </>
  );

  return (
    <>
      {interactive ? (
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls={SITE_MENU_ID}
          aria-haspopup="dialog"
          onClick={show}
          className={cn(controlClassName, "px-3.5")}
        >
          {label}
        </button>
      ) : (
        <a href={`#${SITE_MENU_ID}`} className={cn(controlClassName, "px-3.5")}>
          {label}
        </a>
      )}
      <dialog
        ref={dialog}
        id={SITE_MENU_ID}
        aria-label="Menu"
        onClose={onClose}
        onClick={onClick}
        className={cn(
          "fixed inset-y-0 start-auto end-0 m-0 h-dvh outline-none max-h-none w-full max-w-md flex-col overflow-y-auto border-s bg-background px-7 pt-5 pb-6 text-foreground",
          "translate-x-full transition-[translate,display,overlay] transition-discrete duration-300 ease-brand open:flex open:translate-x-0 starting:open:translate-x-full",
          "backdrop:bg-inverse/30",
          !interactive && "target:flex target:translate-x-0",
        )}
      >
        <div className="mb-7 flex min-h-11 items-center justify-between">
          <BrandLink href={homeHref} />
          {interactive ? (
            <button ref={close} type="button" onClick={() => dialog.current?.close()} className={cn(controlClassName, "size-11")}>
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          ) : (
            <a href="#" className={cn(controlClassName, "size-11")}>
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </a>
          )}
        </div>
        {children}
      </dialog>
    </>
  );
}
