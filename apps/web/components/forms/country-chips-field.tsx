"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Combobox } from "@/components/forms/combobox";
import { FieldMessage } from "@/components/forms/field-message";
import { Field, FieldLabel } from "@/components/ui/field";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { countryCount } from "@/lib/validation/geographies";

type CountryChipsFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id: string;
  label: string;
  description?: string;
  countries: readonly ReferenceItem[];
  // At most this many countries; null when the list is not limited.
  limit: number | null;
  // Shown, and announced, when a country beyond the limit is chosen.
  limitNotice?: React.ReactNode;
};

type ChipsControlProps = Omit<CountryChipsFieldProps<FieldValues, string>, "control" | "name"> & {
  value: string[];
  onChange: (value: string[]) => void;
  onBlur: () => void;
  inputRef: React.Ref<HTMLInputElement>;
  invalid: boolean;
  errorId: string;
  error?: { message?: string };
};

// Several countries in one field (FR-K1 AC2): the country combobox of the home search adds the chosen country as a chip
// and empties itself; each chip has a remove button that Backspace and Delete also press. A country beyond the limit is
// not added and the limit notice is announced instead.
export function CountryChipsField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  ...props
}: CountryChipsFieldProps<T, N>) {
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
  countries,
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
  const [limitReached, setLimitReached] = useState(false);
  const descriptionId = `${id}-description`;
  const countId = `${id}-count`;
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
  const describedBy = [description ? descriptionId : null, countId, error ? errorId : null].filter(Boolean).join(" ");

  function add(code: string) {
    if (code === "" || value.includes(code)) return;
    if (limit !== null && value.length >= limit) {
      setLimitReached(true);
      return;
    }
    setLimitReached(false);
    onChange([...value, code]);
  }

  function remove(code: string) {
    setLimitReached(false);
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
      {/* Enter with typed text that names no country must not send the form: only chosen countries are saved. */}
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
          placeholder="Type a country"
          value=""
          options={toOptions(countries.filter(({ code }) => !value.includes(code)))}
          emptyText="No matching country"
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
        <p className="text-small text-muted-foreground">No countries chosen yet.</p>
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
        {countryCount(value.length, limit)}
      </p>
      <div role="status" className="empty:hidden">
        {limitReached ? limitNotice : null}
      </div>
      <FieldMessage id={errorId} error={error} className="-mt-0.5 flex items-start gap-1.5 text-small leading-snug" />
    </Field>
  );
}
