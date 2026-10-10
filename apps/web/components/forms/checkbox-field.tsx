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

type CheckboxRowProps = {
  id: string;
  name: string;
  inputRef?: React.Ref<HTMLInputElement>;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onBlur: () => void;
  invalid: boolean;
  errorId?: string;
  error?: React.ReactNode;
  children: React.ReactNode;
};

export function CheckboxRow({
  id,
  name,
  inputRef,
  checked,
  onChange,
  onBlur,
  invalid,
  errorId,
  error,
  children,
}: CheckboxRowProps) {
  return (
    <Field
      orientation="horizontal"
      data-invalid={invalid}
      className="relative min-h-11 items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-card sm:p-3"
    >
      <span className="relative z-10 mt-px grid size-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          id={id}
          ref={inputRef}
          name={name}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-sm border-2 border-input bg-card transition-colors checked:border-primary checked:bg-primary aria-invalid:border-destructive"
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
          className="cursor-pointer text-body font-normal leading-snug text-pretty text-foreground wrap-anywhere before:absolute before:inset-0"
        >
          {children}
        </FieldLabel>
        {error}
      </FieldContent>
    </Field>
  );
}

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
        <CheckboxRow
          id={id}
          name={field.name}
          inputRef={field.ref}
          checked={Boolean(field.value)}
          onChange={field.onChange}
          onBlur={field.onBlur}
          invalid={fieldState.invalid}
          errorId={errorId}
          error={<FieldError id={errorId} errors={[fieldState.error]} />}
        >
          {children}
        </CheckboxRow>
      )}
    />
  );
}
