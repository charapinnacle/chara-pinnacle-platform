"use client";

import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { Children, useEffect, useRef, useState } from "react";
import type { ProfileSectionLink, SectionStatus } from "@/components/organization/profile-sections";
import { cn } from "@/lib/utils";

const statusText: Record<SectionStatus, string> = { done: "done", todo: "needs your attention", optional: "optional" };

function StatusIcon({ status }: { status: SectionStatus }) {
  if (status === "done") return <CircleCheck aria-hidden className="size-4 shrink-0 text-success-foreground" />;
  if (status === "todo") return <CircleDot aria-hidden className="size-4 shrink-0 text-brand-ink" />;
  return <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

const tabId = (headingId: string) => `tab-${headingId}`;
const panelId = (headingId: string) => `panel-${headingId}`;

// The sections of the workforce profile as tabs: one section shows at a time. The address keeps the open section after
// its # (the heading's id), so a link such as #licences-heading from the dashboard or a notification opens Licences, and
// a reload stays on it. A column beside the section from lg up, a row that scrolls sideways on a phone.
export function ProfileTabs({
  sections,
  initial,
  children,
}: {
  sections: readonly ProfileSectionLink[];
  initial?: string;
  children: React.ReactNode;
}) {
  const panels = Children.toArray(children);
  const [active, setActive] = useState(initial ?? sections[0].headingId);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!sections.some((section) => section.headingId === id)) return;
      setActive(id);
      root.current?.scrollIntoView({ block: "start" });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [sections]);

  function open(index: number, focus = false) {
    const id = sections[index].headingId;
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) tabs.current[index]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = sections.length - 1;
    const next = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    open(next < 0 ? last : next > last ? 0 : next, true);
  }

  return (
    <div ref={root} className="grid scroll-mt-8 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
      <div
        role="tablist"
        aria-label="Sections of the workforce profile"
        aria-orientation="vertical"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 [contain:inline-size] lg:sticky lg:top-8 lg:mx-0 lg:grid lg:gap-1 lg:overflow-visible lg:px-0 lg:[contain:none]"
      >
        {sections.map((section, index) => {
          const selected = section.headingId === active;
          return (
            <button
              key={section.headingId}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId(section.headingId)}
              aria-selected={selected}
              aria-controls={panelId(section.headingId)}
              tabIndex={selected ? 0 : -1}
              onClick={() => open(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-start text-small font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "border-foreground bg-card text-foreground lg:shadow-xs"
                  : "bg-card text-muted-foreground hover:text-foreground lg:border-transparent lg:bg-transparent",
              )}
            >
              <StatusIcon status={section.status} />
              {section.title}
              <span className="sr-only">, {statusText[section.status]}</span>
            </button>
          );
        })}
      </div>
      {sections.map((section, index) => (
        <div
          key={section.headingId}
          role="tabpanel"
          id={panelId(section.headingId)}
          aria-labelledby={tabId(section.headingId)}
          hidden={section.headingId !== active}
          className="min-w-0"
        >
          {panels[index]}
        </div>
      ))}
    </div>
  );
}
