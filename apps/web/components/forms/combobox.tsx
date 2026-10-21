"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { controlClassName } from "@/components/forms/control-class";
import { NativeSelect } from "@/components/forms/native-select";
import { Input } from "@/components/ui/input";
import {
  COMBOBOX_LIMIT,
  listStart,
  matchOptions,
  moveActive,
  resultsAnnouncement,
  type ComboboxMatches,
  type ComboboxOption,
} from "@/lib/combobox";
import { cn } from "@/lib/utils";

export type ComboboxProps = {
  id: string;
  name: string;
  // A form that is sent by the browser (not React Hook Form) names the visible input, which in free-text mode carries the value.
  inputName?: string;
  inputClassName?: string;
  // The popup and its rows, for a form that styles them its own way; the chosen option then shows a check.
  listClassName?: string;
  optionClassName?: string;
  checkChosen?: boolean;
  // The options were already matched to the typed text (by the server) and are listed as given, in their order.
  prefiltered?: boolean;
  maxLength?: number;
  label: string;
  placeholder: string;
  value: string;
  options: readonly ComboboxOption[];
  emptyText: string;
  freeText: boolean;
  noScriptSelect: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onBlur: () => void;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

function optionId(id: string, index: number): string {
  return `${id}-option-${index}`;
}

const NO_MATCHES: ComboboxMatches = { shown: [], total: 0 };

// Choosing mode: the value is the code of one option and typed text only filters. Free-text mode: the value is the text
// itself, the options are suggestions, and Enter without an arrowed-to suggestion keeps the typed text. The list is only
// in the page while it is open, and holds at most COMBOBOX_LIMIT options; typing narrows what the whole list offers.
// React Hook Form reads the value from state, so the visible input has no name; a form that must submit without
// JavaScript sets noScriptSelect, and a native select with the code as value then takes its place.
export function Combobox({
  id,
  name,
  inputName,
  inputClassName,
  listClassName,
  optionClassName,
  checkChosen = false,
  prefiltered = false,
  maxLength,
  label,
  placeholder,
  value,
  options,
  emptyText,
  freeText,
  noScriptSelect,
  inputRef,
  onChange,
  onBlur,
  ...aria
}: ComboboxProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [navigated, setNavigated] = useState(false);

  const selected = freeText ? undefined : options.find((option) => option.value === value);
  const text = freeText ? value : (query ?? selected?.label ?? "");
  const selectedIndex = selected ? options.indexOf(selected) : -1;
  const matches = !open
    ? NO_MATCHES
    : prefiltered
      ? { shown: options.slice(0, COMBOBOX_LIMIT), total: options.length }
      : matchOptions(options, freeText ? value : (query ?? ""), query === null ? selectedIndex : -1);
  const count = matches.shown.length;
  const active = Math.min(activeIndex, count - 1);
  const listed = open && !(freeText && matches.total === 0);
  const startIndex = selectedIndex < 0 ? -1 : selectedIndex - listStart(options.length, selectedIndex);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(id, active))?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function close() {
    setOpen(false);
    setQuery(null);
    setNavigated(false);
  }

  function show(index: number) {
    setOpen(true);
    setActiveIndex(index);
  }

  function choose(option: ComboboxOption) {
    onChange(freeText ? option.label : option.value);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      setNavigated(true);
      if (open) setActiveIndex(moveActive(key, active, count));
      else show(Math.max(startIndex, 0));
    } else if ((key === "Home" || key === "End") && open && navigated && count > 0) {
      event.preventDefault();
      setActiveIndex(moveActive(key, active, count));
    } else if (key === "Enter" && open && matches.shown[active]) {
      event.preventDefault();
      choose(matches.shown[active]);
    } else if (key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  return (
    <div className="relative">
      <Input
        {...aria}
        id={id}
        name={inputName}
        maxLength={maxLength}
        ref={inputRef}
        role="combobox"
        autoComplete="off"
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls={listed ? `${id}-listbox` : undefined}
        aria-activedescendant={listed && active >= 0 ? optionId(id, active) : undefined}
        className={cn(controlClassName, "h-12 pe-12", noScriptSelect && "noscript:hidden", inputClassName)}
        value={text}
        onChange={(event) => {
          setQuery(event.target.value);
          setNavigated(false);
          show(freeText ? -1 : 0);
          if (freeText || event.target.value === "") onChange(event.target.value);
        }}
        onClick={() => {
          if (!open) show(startIndex);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          onBlur();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Show ${label} options`}
        className={cn(
          "absolute end-0 top-0 grid h-12 w-12 place-items-center rounded-e-control text-muted-foreground",
          noScriptSelect && "noscript:hidden",
        )}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          document.getElementById(id)?.focus();
          if (open) close();
          else show(startIndex);
        }}
      >
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {noScriptSelect ? (
        <noscript>
          <NativeSelect name={name} aria-label={label} defaultValue={value}>
            <option value="">{placeholder}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </noscript>
      ) : null}
      <div aria-live="polite" aria-atomic className="sr-only">
        {listed ? resultsAnnouncement(matches, emptyText) : null}
      </div>
      {listed ? (
        <div
          className={cn(
            "absolute inset-x-0 z-20 mt-1 overflow-hidden rounded-control border border-input bg-card text-base shadow-md",
            listClassName,
          )}
          onMouseDown={(event) => event.preventDefault()}
        >
          <ul id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-60 overflow-auto py-1">
            {matches.total === 0 ? (
              <li role="option" aria-disabled aria-selected={false} className="px-4 py-2 text-muted-foreground">
                {emptyText}
              </li>
            ) : (
              matches.shown.map((option, index) => {
                const chosen = checkChosen && (freeText ? option.label === value : option.value === value);
                return (
                  <li
                    key={option.value}
                    id={optionId(id, index)}
                    role="option"
                    aria-selected={index === active}
                    onClick={() => choose(option)}
                    className={cn(
                      "min-h-11 cursor-pointer px-4 py-2.5 hover:bg-accent",
                      optionClassName,
                      index === active && "bg-accent text-accent-foreground",
                    )}
                  >
                    {checkChosen ? (
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0">{option.label}</span>
                        {chosen ? <Check aria-hidden className="size-4 shrink-0" /> : null}
                      </span>
                    ) : (
                      option.label
                    )}
                  </li>
                );
              })
            )}
          </ul>
          {matches.total > count ? (
            <p className="border-t px-4 py-2 text-small text-muted-foreground">
              Showing {count} of {matches.total}. Type to narrow the list.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
