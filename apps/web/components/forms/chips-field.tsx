"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Combobox } from "@/components/forms/combobox";
import { FieldMessage } from "@/components/forms/field-message";
import { Field, FieldLabel } from "@/components/ui/field";
import type { ComboboxOption } from "@/lib/combobox";
import { chosenCount, type Noun } from "@/lib/chips";

// An option of the list; chip names it on its chip when the list label carries more (the code of an occupation).
export type ChipOption = ComboboxOption & { chip?: string };

type ChipsFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id: string;
  label: string;
  description?: string;
  options: readonly ChipOption[];
  placeholder: string;
  emptyText: string;
  noneChosen: string;
  noun: Noun;
  // At most this many values; null when the list is not limited.
  limit: number | null;
  // Shown, and announced, when a value beyond the limit is chosen.
  limitNotice?: React.ReactNode;
};

type ChipsControlProps = Omit<ChipsFieldProps<FieldValues, string>, "control" | "name"> & {
  value: string[];
  onChange: (value: string[]) => void;
  onBlur: () => void;
  inputRef: React.Ref<HTMLInputElement>;
  invalid: boolean;
  errorId: string;
  error?: { message?: string };
};

// Several values of a code list in one field (FR-K1 AC2, FR-K2 AC2): the combobox of the home search adds the chosen
// option as a chip and empties itself; each chip has a remove button that Backspace and Delete also press. A value beyond
// the limit is not added and the limit notice is announced instead.
export function ChipsField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  ...props
}: ChipsFieldProps<T, N>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <ChipsControl
          {...props}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          invalid={fieldState.invalid}
          errorId={`${props.id}-error`}
          error={fieldState.error}
        />
      )}
    />
  );
}

function ChipsControl({
  id,
  label,
  description,
  options,
  placeholder,
  emptyText,
  noneChosen,
  noun,
  limit,
  limitNotice,
  value,
  onChange,
  onBlur,
  inputRef,
  invalid,
  errorId,
  error,
}: ChipsControlProps) {
  // Each blocked add is counted, and the notice is keyed by the count: a screen reader announces the replaced content of
  // the live region again on the second and later attempts, which an unchanged text would not trigger.
  const [blockedAttempts, setBlockedAttempts] = useState(0);
  const descriptionId = `${id}-description`;
  const countId = `${id}-count`;
  const nameOf = (code: string) => {
    const option = options.find(({ value: optionValue }) => optionValue === code);
    return option?.chip ?? option?.label ?? code;
  };
  const describedBy = [description ? descriptionId : null, countId, error ? errorId : null].filter(Boolean).join(" ");

  function add(code: string) {
    if (code === "" || value.includes(code)) return;
    if (limit !== null && value.length >= limit) {
      setBlockedAttempts((attempts) => attempts + 1);
      return;
    }
    setBlockedAttempts(0);
    onChange([...value, code]);
  }

  function remove(code: string) {
    setBlockedAttempts(0);
    onChange(value.filter((chosen) => chosen !== code));
    document.getElementById(id)?.focus();
  }

  return (
    <Field data-invalid={invalid} className="data-[invalid=true]:text-foreground">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {description ? (
        <p id={descriptionId} className="-mt-0.5 text-small leading-normal text-muted-foreground">
          {description}
        </p>
      ) : null}
      {/* Enter with typed text that names no option must not send the form: only chosen values are saved. */}
      <div
        onKeyDown={(event) => {
          const typed = event.target instanceof HTMLInputElement && event.target.value !== "";
          if (event.key === "Enter" && !event.defaultPrevented && typed) event.preventDefault();
        }}
      >
        <Combobox
          id={id}
          name={`${id}-search`}
          label={label}
          placeholder={placeholder}
          value=""
          options={options.filter((option) => !value.includes(option.value))}
          emptyText={emptyText}
          freeText={false}
          noScriptSelect={false}
          inputRef={inputRef}
          onChange={add}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      </div>
      {value.length === 0 ? (
        <p className="text-small text-muted-foreground">{noneChosen}</p>
      ) : (
        <ul aria-label={`${label} chosen`} className="flex flex-wrap gap-2">
          {value.map((code) => (
            <li
              key={code}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border bg-secondary ps-3 pe-1 text-small text-foreground"
            >
              {nameOf(code)}
              <button
                type="button"
                aria-label={`Remove ${nameOf(code)}`}
                className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => remove(code)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" || event.key === "Delete") {
                    event.preventDefault();
                    remove(code);
                  }
                }}
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p id={countId} aria-live="polite" className="-mt-0.5 text-small text-muted-foreground tabular-nums">
        {chosenCount(value.length, limit, noun)}
      </p>
      <div role="status" className="empty:hidden">
        {blockedAttempts > 0 ? <div key={blockedAttempts}>{limitNotice}</div> : null}
      </div>
      <FieldMessage id={errorId} error={error} className="-mt-0.5 flex items-start gap-1.5 text-small leading-snug" />
    </Field>
  );
}
