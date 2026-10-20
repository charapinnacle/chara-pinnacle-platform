"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { FieldMessage } from "@/components/forms/field-message";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

// The one checkbox of the interface: 20 px, a 6 px radius and a 1.5 px neutral border; checked, it is filled near-black with
// a white check. The accent is only for the focus outline of globals.css, which the native input draws.
export function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <input
        type="checkbox"
        className={cn(
          "peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-sm border-[1.5px] border-input bg-card transition-colors duration-120 hover:border-muted-foreground checked:border-primary checked:bg-primary aria-invalid:border-destructive aria-invalid:checked:bg-destructive disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 size-3 scale-75 text-primary-foreground opacity-0 transition-[opacity,scale] duration-120 peer-checked:scale-100 peer-checked:opacity-100 peer-disabled:opacity-0 motion-reduce:transition-none"
      />
    </span>
  );
}

type CheckboxRowProps = {
  id: string;
  name: string;
  inputRef?: React.Ref<HTMLInputElement>;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onBlur: () => void;
  invalid: boolean;
  errorId?: string;
  error?: { message?: string };
  // A quiet line under the label (a version and a date); it is part of the description of the checkbox, not of its name.
  meta?: React.ReactNode;
  // Consents use the small type size, as sign-up forms commonly do, so a list of documents stays compact.
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
};

// A checkbox and its label as one row, at least 44 px high, of which every pixel toggles the box: the label covers the row
// (a link inside it takes relative z-10 to stay clickable).
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
  meta,
  compact = false,
  className,
  children,
}: CheckboxRowProps) {
  const metaId = `${id}-meta`;
  const describedBy = [meta ? metaId : null, invalid && errorId ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field
      orientation="horizontal"
      data-invalid={invalid}
      className={cn("relative min-h-11 items-start gap-3 py-2.5 data-[invalid=true]:text-foreground", className)}
    >
      <span className="relative z-10 mt-px">
        <Checkbox
          id={id}
          ref={inputRef}
          name={name}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      </span>
      <FieldContent className={compact ? "gap-0.5" : "gap-1"}>
        <FieldLabel
          htmlFor={id}
          className={cn(
            "cursor-pointer font-normal leading-snug text-pretty text-foreground wrap-anywhere before:absolute before:inset-0",
            compact ? "text-small" : "text-body",
          )}
        >
          {children}
        </FieldLabel>
        {meta ? (
          <p
            id={metaId}
            className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground", compact ? "text-caption" : "text-small")}
          >
            {meta}
          </p>
        ) : null}
        {errorId ? <FieldMessage id={errorId} error={error} /> : null}
      </FieldContent>
    </Field>
  );
}

type CheckboxFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  meta?: React.ReactNode;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function CheckboxField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  meta,
  compact,
  className,
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
          error={fieldState.error}
          meta={meta}
          compact={compact}
          className={className}
        >
          {children}
        </CheckboxRow>
      )}
    />
  );
}
