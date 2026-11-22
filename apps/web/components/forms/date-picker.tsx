"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { controlClassName } from "@/components/forms/control-class";
import { addDays, addMonths, daysInMonth, isoDate, monthGrid, parseIsoDate, todayIso, type Day } from "@/lib/date-picker";
import { formatDate } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
] as const;

type DatePickerProps = {
  id: string;
  name: string;
  // Controlled by a form (an ISO date or ""), or uncontrolled from defaultValue on a plain GET form.
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLButtonElement>;
  min?: string;
  max?: string;
  placeholder?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

// One date control for the whole app: a field that reads "12 March 2027" and opens a calendar under it, so nobody types
// a date in a format. The value stays an ISO date (2027-03-12) in a hidden input of the same name, for the form and for
// a plain GET form alike. The calendar is placed with classes, not by a positioning library, as the content security
// policy refuses style attributes. Keyboard: arrows move by a day or a week, Page Up and Page Down by a month, Home and
// End to the week's ends, Enter picks, Escape closes.
export function DatePicker({
  id,
  name,
  value: controlled,
  defaultValue = "",
  onChange,
  onBlur,
  inputRef,
  min,
  max,
  placeholder = "Choose a date",
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: DatePickerProps) {
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  const chosen = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<Day>(() => chosen ?? parseIsoDate(todayIso())!);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // The day takes the focus when the calendar opens or a key moves it, not when the month or year list changes it.
  const moveFocus = useRef(false);
  const valueId = `${id}-value`;
  const today = todayIso();
  const minDay = parseIsoDate(min ?? "");
  const maxDay = parseIsoDate(max ?? "");
  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.min(minDay?.y ?? thisYear - 80, chosen?.y ?? thisYear, focus.y);
  const lastYear = Math.max(maxDay?.y ?? thisYear + 20, chosen?.y ?? thisYear, focus.y);
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [open, focus]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });

  function close(refocus: boolean) {
    setOpen(false);
    onBlur?.();
    if (refocus) trigger.current?.focus();
  }

  function pick(next: string) {
    if (controlled === undefined) setOwn(next);
    onChange?.(next);
    close(true);
  }

  function openCalendar() {
    moveFocus.current = true;
    setFocus(chosen ?? parseIsoDate(today)!);
    setOpen(true);
  }

  function onGridKey(event: React.KeyboardEvent) {
    const moves: Record<string, () => Day> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1),
      PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, -((new Date(Date.UTC(focus.y, focus.m - 1, focus.d)).getUTCDay() + 6) % 7)),
      End: () => addDays(focus, 6 - ((new Date(Date.UTC(focus.y, focus.m - 1, focus.d)).getUTCDay() + 6) % 7)),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus.current = true;
    setFocus(move());
  }

  const weeks = monthGrid(focus.y, focus.m);
  const setView = (y: number, m: number) => setFocus({ y, m, d: Math.min(focus.d, daysInMonth(y, m)) });

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        ref={(node) => {
          trigger.current = node;
          if (typeof inputRef === "function") inputRef(node);
          else if (inputRef) inputRef.current = node;
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-invalid={invalid || undefined}
        aria-describedby={[valueId, describedBy].filter(Boolean).join(" ")}
        onClick={() => (open ? close(false) : openCalendar())}
        className={cn("flex h-12 w-full items-center gap-3 border text-start data-[invalid=true]:border-destructive", controlClassName)}
      >
        <CalendarDays aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span aria-hidden className={cn("min-w-0 flex-1 truncate", !chosen && "text-muted-foreground")}>
          {chosen ? formatDate(value) : placeholder}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <span id={valueId} className="sr-only">
        {chosen ? formatDate(value) : "No date chosen"}
      </span>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute start-0 z-30 mt-2 w-full min-w-[19rem] max-w-[22rem] rounded-xl border bg-card p-3 shadow-card"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              className="grid size-9 place-items-center rounded-lg hover:bg-secondary"
              onClick={() => setFocus(addMonths(focus, -1))}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </button>
            <select
              aria-label="Month"
              value={focus.m}
              onChange={(event) => setView(focus.y, Number(event.target.value))}
              className="h-9 min-w-0 flex-1 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-small font-semibold hover:bg-secondary"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
            <select
              aria-label="Year"
              value={focus.y}
              onChange={(event) => setView(Number(event.target.value), focus.m)}
              className="h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-small font-semibold tabular-nums hover:bg-secondary"
            >
              {Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next month"
              className="grid size-9 place-items-center rounded-lg hover:bg-secondary"
              onClick={() => setFocus(addMonths(focus, 1))}
            >
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>
          <div ref={grid} role="grid" aria-label={`${MONTHS[focus.m - 1]} ${focus.y}`} className="mt-2 grid gap-1" onKeyDown={onGridKey}>
            <div role="row" className="grid grid-cols-7">
              {WEEKDAYS.map(([short, long]) => (
                <span key={short} role="columnheader" aria-label={long} className="py-1 text-center text-caption font-medium text-muted-foreground">
                  {short}
                </span>
              ))}
            </div>
            {weeks.map((week, row) => (
              <div key={row} role="row" className="grid grid-cols-7 gap-1">
                {week.map((day, column) => {
                  if (!day) return <span key={column} role="gridcell" />;
                  const iso = isoDate(day);
                  const selected = iso === value;
                  const isFocus = day.d === focus.d;
                  const enabled = allowed(iso);
                  return (
                    <span key={column} role="gridcell" aria-selected={selected}>
                      <button
                        type="button"
                        tabIndex={isFocus ? 0 : -1}
                        disabled={!enabled}
                        aria-label={formatDate(iso)}
                        aria-current={iso === today ? "date" : undefined}
                        onClick={() => pick(iso)}
                        onFocus={() => (isFocus ? undefined : setFocus(day))}
                        className={cn(
                          "grid aspect-square w-full place-items-center rounded-lg text-small tabular-nums transition-colors",
                          "hover:bg-secondary disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent",
                          iso === today && !selected && "font-semibold ring-1 ring-border ring-inset",
                          selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                        )}
                      >
                        {day.d}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <button
              type="button"
              disabled={!allowed(today)}
              onClick={() => pick(today)}
              className="rounded-lg px-3 py-1.5 text-small font-medium hover:bg-secondary disabled:text-muted-foreground"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => pick("")}
              className="rounded-lg px-3 py-1.5 text-small font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
