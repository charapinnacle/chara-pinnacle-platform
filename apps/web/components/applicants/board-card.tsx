"use client";

import { useEffect, useRef, useState } from "react";
import { SelectApplicant } from "@/components/applicants/bulk-selection";
import { NewBadge } from "@/components/applicants/new-badge";
import { TextLink } from "@/components/forms/text-link";
import { applicationStatusLabels, FORMER_CANDIDATE } from "@/lib/applications/presentation";
import type { ApplicantRow } from "@/lib/dal/applicant-list";
import { formatShortDate } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

type Status = ApplicantRow["status"];

type BoardCardProps = {
  row: ApplicantRow;
  href: string;
  targets: readonly Status[];
  frozen: boolean;
  onMove: (row: ApplicantRow, target: Status) => void;
  onDragStart: (row: ApplicantRow) => void;
  onDragEnd: () => void;
};

export const moveButtonId = (id: string) => `move-${id}`;

// The Move button is the keyboard and screen reader way to do what dragging does: Enter opens the menu of the stages the
// card may go to, the arrow keys choose one, Enter applies it and Escape closes it. A final card has nothing to move to,
// so it has no button and cannot be dragged; a frozen board (a lapsed organisation) shows the button disabled.
export function BoardCard({ row, href, targets, frozen, onMove, onDragStart, onDragEnd }: BoardCardProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const name = row.candidateName ?? FORMER_CANDIDATE;
  const draggable = !frozen && targets.length > 0;

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(items.indexOf(document.activeElement as HTMLElement) + step + items.length) % items.length]?.focus();
  }

  return (
    <li
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.id);
        onDragStart(row);
      }}
      onDragEnd={onDragEnd}
      className={cn("grid gap-2 rounded-xl border bg-card p-3", draggable && "cursor-grab")}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium wrap-anywhere">
        <SelectApplicant id={row.id} name={name} />
        <TextLink href={href}>{name}</TextLink>
        {row.status === "applied" ? <NewBadge /> : null}
      </p>
      <p className="text-sm text-muted-foreground">
        <time dateTime={row.appliedAt}>{formatShortDate(row.appliedAt)}</time>
        {" · "}
        {row.completeness} % · {row.documents} {row.documents === 1 ? "document" : "documents"}
      </p>
      {targets.length > 0 ? (
        <div
          className="relative"
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <button
            ref={trigger}
            id={moveButtonId(row.id)}
            type="button"
            disabled={frozen}
            aria-label={`Move ${name}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="min-h-11 rounded-lg border border-input bg-card px-3 text-sm font-medium hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          >
            Move
          </button>
          {open ? (
            <ul
              ref={menu}
              role="menu"
              aria-label={`Move ${name} to`}
              className="absolute start-0 top-full z-10 mt-1 grid min-w-44 gap-0.5 rounded-lg border bg-card p-1 shadow-card"
            >
              {targets.map((target) => (
                <li key={target} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="min-h-11 w-full rounded-md px-3 text-start text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                    onClick={() => {
                      setOpen(false);
                      onMove(row, target);
                    }}
                  >
                    {applicationStatusLabels[target]}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
