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
          className="relative items-start gap-3 rounded-lg p-3 transition-colors hover:bg-card data-[invalid=true]:bg-destructive-surface"
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
            className="relative z-10 mt-px size-5 shrink-0 cursor-pointer accent-primary"
          />
          <FieldContent>
            <FieldLabel
              htmlFor={id}
              className="cursor-pointer text-[0.9375rem] font-normal leading-snug before:absolute before:inset-0"
            >
              {children}
            </FieldLabel>
            <FieldError id={errorId} errors={[fieldState.error]} />
          </FieldContent>
        </Field>
      )}
    />
  );
}
