"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PricingTab = { key: string; label: string; panel: ReactNode };

// The plans of each organisation type as tabs (FR-R1 AC3, FR-L5). The arrow keys, Home and End move between the tabs and
// select the one they reach (automatic activation); Tab moves into the selected panel. Every panel is rendered on the
// server; the panels not selected are hidden.
export function PricingTabs({ label, tabs }: { label: string; tabs: readonly PricingTab[] }) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    setSelected(index);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = tabs.length - 1;
    const next = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next > last ? 0 : next < 0 ? last : next);
  }

  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-selected={index === selected}
            aria-controls={`${id}-panel-${tab.key}`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-4 text-small font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              index === selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-panel-${tab.key}`}
          aria-labelledby={`${id}-tab-${tab.key}`}
          hidden={index !== selected}
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
