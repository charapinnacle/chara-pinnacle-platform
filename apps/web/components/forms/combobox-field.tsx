"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { FieldPath, FieldValues } from "react-hook-form";
import { controlClassName } from "@/components/forms/control-class";
import { FormField } from "@/components/forms/form-field";
import { Input } from "@/components/ui/input";
import {
  COMBOBOX_LIMIT,
  matchOptions,
  moveActive,
  resultsAnnouncement,
  type ComboboxMatches,
  type ComboboxOption,
} from "@/lib/combobox";
import { cn } from "@/lib/utils";

type ComboboxFieldProps<T extends FieldValues, N extends FieldPath<T>> = Omit<
  React.ComponentProps<typeof FormField<T, N>>,
  "children"
> & {
  placeholder: string;
  options: readonly ComboboxOption[];
  emptyText?: string;
  freeText?: boolean;
};

type ComboboxProps = {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  value: string;
  options: readonly ComboboxOption[];
  emptyText: string;
  freeText: boolean;
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
function Combobox({
  id,
  name,
  label,
  placeholder,
  value,
  options,
  emptyText,
  freeText,
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
  const matches = open ? matchOptions(options, freeText ? value : (query ?? "")) : NO_MATCHES;
  const count = matches.shown.length;
  const active = Math.min(activeIndex, count - 1);
  const listed = open && !(freeText && matches.total === 0);
  const selectedIndex = selected ? options.indexOf(selected) : -1;
  const startIndex = selectedIndex < COMBOBOX_LIMIT ? selectedIndex : -1;

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
        name={name}
        ref={inputRef}
        role="combobox"
        autoComplete="off"
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listed ? `${id}-listbox` : undefined}
        aria-activedescendant={listed && active >= 0 ? optionId(id, active) : undefined}
        className={cn("h-11 pe-11", controlClassName)}
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
        className="absolute end-0 top-0 grid h-11 w-11 place-items-center rounded-e-lg text-muted-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          document.getElementById(id)?.focus();
          if (open) close();
          else show(startIndex);
        }}
      >
        <ChevronDown aria-hidden className="size-4" />
      </button>
      <div aria-live="polite" aria-atomic className="sr-only">
        {listed ? resultsAnnouncement(matches, emptyText) : null}
      </div>
      {listed ? (
        <div
          className="absolute inset-x-0 z-10 mt-1 overflow-hidden rounded-lg border border-input bg-card text-base shadow-md"
          onMouseDown={(event) => event.preventDefault()}
        >
          <ul id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-60 overflow-auto py-1">
            {matches.total === 0 ? (
              <li role="option" aria-disabled aria-selected={false} className="px-3.5 py-2 text-muted-foreground">
                {emptyText}
              </li>
            ) : (
              matches.shown.map((option, index) => (
                <li
                  key={option.value}
                  id={optionId(id, index)}
                  role="option"
                  aria-selected={index === active}
                  onClick={() => choose(option)}
                  className={cn(
                    "min-h-11 cursor-pointer px-3.5 py-2.5 hover:bg-accent",
                    index === active && "bg-accent text-accent-foreground",
                  )}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
          {matches.total > count ? (
            <p className="border-t px-3.5 py-2 text-small text-muted-foreground">
              Showing the first {count} of {matches.total}. Type to narrow the list.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ComboboxField<T extends FieldValues, N extends FieldPath<T>>({
  placeholder,
  options,
  emptyText = "No match",
  freeText = false,
  ...fieldProps
}: ComboboxFieldProps<T, N>) {
  return (
    <FormField {...fieldProps}>
      {({ ref, value, ...controlProps }) => (
        <Combobox
          {...controlProps}
          label={fieldProps.label}
          placeholder={placeholder}
          inputRef={ref}
          value={String(value ?? "")}
          options={options}
          emptyText={emptyText}
          freeText={freeText}
        />
      )}
    </FormField>
  );
}
