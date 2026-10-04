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
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

type CheckboxFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  children: React.ReactNode;
};

export function CheckboxField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  children,
}: CheckboxFieldProps<T, N>) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          orientation="horizontal"
          data-invalid={fieldState.invalid}
          className="items-start"
        >
          <input
            type="checkbox"
            id={id}
            ref={field.ref}
            name={field.name}
            checked={Boolean(field.value)}
            onChange={(event) => field.onChange(event.target.checked)}
            onBlur={field.onBlur}
            aria-invalid={fieldState.invalid}
            aria-describedby={fieldState.error ? errorId : undefined}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <FieldContent>
            <FieldLabel htmlFor={id} className="font-normal leading-snug">
              {children}
            </FieldLabel>
            <FieldError id={errorId} errors={[fieldState.error]} />
          </FieldContent>
        </Field>
      )}
    />
  );
}
