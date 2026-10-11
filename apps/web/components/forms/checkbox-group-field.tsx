"use client";

import { useId } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { CheckboxRow } from "@/components/forms/checkbox-field";
import { FieldMessage } from "@/components/forms/field-message";
import { FieldLegend, FieldSet } from "@/components/ui/field";

type Option = { value: string; label: string };

type CheckboxGroupFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  legend: string;
  options: readonly Option[];
};

export function CheckboxGroupField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  legend,
  options,
}: CheckboxGroupFieldProps<T, N>) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected: string[] = field.value;
        return (
          <FieldSet id={id} className="gap-0" data-invalid={fieldState.invalid}>
            <FieldLegend variant="label" className="mb-1">
              {legend}
            </FieldLegend>
            {options.map((option, index) => (
              <CheckboxRow
                key={option.value}
                id={`${id}-${option.value}`}
                name={field.name}
                inputRef={index === 0 ? field.ref : undefined}
                checked={selected.includes(option.value)}
                onChange={(checked) =>
                  field.onChange(checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))
                }
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                errorId={errorId}
              >
                {option.label}
              </CheckboxRow>
            ))}
            <FieldMessage id={errorId} error={fieldState.error} />
          </FieldSet>
        );
      }}
    />
  );
}
