"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { FieldPath, FieldValues } from "react-hook-form";
import { controlClassName } from "@/components/forms/control-class";
import { FormField } from "@/components/forms/form-field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string; keywords?: string };

type ComboboxFieldProps<T extends FieldValues, N extends FieldPath<T>> = Omit<
  React.ComponentProps<typeof FormField<T, N>>,
  "children"
> & {
  placeholder: string;
  options: readonly Option[];
  emptyText?: string;
  freeText?: boolean;
};

type ComboboxProps = {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  value: string;
  options: readonly Option[];
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

// Choosing mode: the value is the code of one option and typed text only filters. Free-text mode: the value is the text
// itself, the options are suggestions, and Enter without an arrowed-to suggestion keeps the typed text.
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
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = freeText ? undefined : options.find((option) => option.value === value);
  const text = freeText ? value : (query ?? selected?.label ?? "");
  const needle = (freeText ? value : (query ?? "")).trim().toLowerCase();
  const matches = needle
    ? options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle))
    : options;
  const active = Math.min(activeIndex, matches.length - 1);

  useEffect(() => {
    if (open) document.getElementById(optionId(id, active))?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function choose(option: Option) {
    onChange(freeText ? option.label : option.value);
    setQuery(null);
    setOpen(false);
  }

  function show(index: number) {
    setOpen(true);
    setActiveIndex(index);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) setActiveIndex(Math.min(active + 1, matches.length - 1));
      else show(Math.max(0, matches.indexOf(selected ?? options[0])));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      show(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && open && matches[active]) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery(null);
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
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && matches[active] ? optionId(id, active) : undefined}
        className={cn("h-11 pe-10", controlClassName)}
        value={text}
        onChange={(event) => {
          setQuery(event.target.value);
          show(freeText ? -1 : 0);
          if (freeText || event.target.value === "") onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
          onBlur();
        }}
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-3.5 size-4 text-muted-foreground" />
      <ul
        id={`${id}-listbox`}
        role="listbox"
        aria-label={label}
        hidden={!open || (freeText && matches.length === 0)}
        className="absolute inset-x-0 z-10 mt-1 max-h-60 overflow-auto rounded-lg border border-input bg-card py-1 text-base shadow-md"
      >
        {matches.length === 0 ? (
          <li role="option" aria-disabled aria-selected={false} className="px-3.5 py-2 text-muted-foreground">
            {emptyText}
          </li>
        ) : (
          matches.map((option, index) => (
            <li
              key={option.value}
              id={optionId(id, index)}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className={cn("min-h-11 cursor-pointer px-3.5 py-2.5", index === active && "bg-accent text-accent-foreground")}
            >
              {option.label}
            </li>
          ))
        )}
      </ul>
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
