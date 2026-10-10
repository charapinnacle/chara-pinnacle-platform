"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type MenuDisclosureProps = {
  label: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  buttonClassName?: string;
  children: React.ReactNode;
};

// A button that shows a panel of links or buttons: the disclosure pattern, so it opens with Enter, Space or a tap, the
// next Tab enters the panel, and Escape or a press outside closes it and gives the focus back to the button.
export function MenuDisclosure({ label, icon, className, buttonClassName, children }: MenuDisclosureProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    button.current?.focus();
  }

  function onPanelClick(event: React.MouseEvent) {
    if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
  }

  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex min-h-11 max-w-56 items-center gap-2 rounded-lg px-3 text-small font-medium hover:bg-accent",
          buttonClassName,
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        onClick={onPanelClick}
        className="absolute end-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-2 shadow-card"
      >
        {children}
      </div>
    </div>
  );
}
