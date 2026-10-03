"use client";

import { useId } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

type RadioOption = { value: string; label: string };

type RadioGroupFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  legend: string;
  description?: string;
  options: readonly RadioOption[];
  onValueChange?: (value: string) => void;
};

export function RadioGroupField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  legend,
  description,
  options,
  onValueChange,
}: RadioGroupFieldProps<T, N>) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy =
          [description ? descriptionId : null, fieldState.error ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined;
        return (
          <FieldSet
            role="radiogroup"
            aria-describedby={describedBy}
            aria-invalid={fieldState.invalid}
            data-invalid={fieldState.invalid}
            className="data-[invalid=true]:text-destructive"
          >
            <FieldLegend variant="label">{legend}</FieldLegend>
            {description ? (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            ) : null}
            {options.map((option, index) => {
              const optionId = index === 0 ? id : `${id}-${option.value}`;
              return (
                <Field key={option.value} orientation="horizontal">
                  <input
                    type="radio"
                    id={optionId}
                    ref={index === 0 ? field.ref : undefined}
                    name={field.name}
                    value={option.value}
                    checked={field.value === option.value}
                    onChange={() => {
                      field.onChange(option.value);
                      onValueChange?.(option.value);
                    }}
                    onBlur={field.onBlur}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <FieldLabel htmlFor={optionId} className="font-normal">
                    {option.label}
                  </FieldLabel>
                </Field>
              );
            })}
            <FieldError id={errorId} errors={[fieldState.error]} />
          </FieldSet>
        );
      }}
    />
  );
}
