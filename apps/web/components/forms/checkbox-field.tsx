"use client";

import { Check } from "lucide-react";
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
          className="relative items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-card sm:p-3"
        >
          <span className="relative z-10 mt-px grid size-5 shrink-0 place-items-center">
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
              className="peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-md border-2 border-input bg-card transition-colors checked:border-primary checked:bg-primary aria-invalid:border-destructive"
            />
            <Check
              aria-hidden
              strokeWidth={3}
              className="pointer-events-none col-start-1 row-start-1 size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
            />
          </span>
          <FieldContent>
            <FieldLabel
              htmlFor={id}
              className="cursor-pointer text-[0.9375rem] font-normal leading-snug text-pretty text-foreground before:absolute before:inset-0"
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
