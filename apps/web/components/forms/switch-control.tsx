"use client";

import { cn } from "@/lib/utils";

type SwitchControlProps = {
  checked: boolean;
  pending?: boolean;
  labelledBy: string;
  describedBy?: string;
  onToggle: () => void;
};

// An on/off switch with the look of the company page switch: a button with role switch, named by a visible label. While
// a call runs it stays focusable and announces itself disabled, so a second press is ignored without losing the focus.
export function SwitchControl({ checked, pending = false, labelledBy, describedBy, onToggle }: SwitchControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={pending}
      onClick={() => {
        if (!pending) onToggle();
      }}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors aria-disabled:cursor-progress",
        checked ? "bg-primary" : "bg-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("inline-block size-6 rounded-full bg-card shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0")}
      />
    </button>
  );
}
