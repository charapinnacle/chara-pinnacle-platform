"use client";

import { useId } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { Checkbox } from "@/components/forms/checkbox";
import { FieldMessage } from "@/components/forms/field-message";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

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
  // An on/off setting that takes effect when saved is announced as a switch.
  asSwitch?: boolean;
  // The whole label as text, for a label that holds a link: some assistive technologies name the box from the label's
  // text before the link only, or not at all.
  accessibleName?: string;
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
  asSwitch = false,
  accessibleName,
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
          role={asSwitch ? "switch" : undefined}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-label={accessibleName}
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
  accessibleName?: string;
  className?: string;
  children: React.ReactNode;
};

export function CheckboxField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  meta,
  compact,
  accessibleName,
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
          accessibleName={accessibleName}
          className={className}
        >
          {children}
        </CheckboxRow>
      )}
    />
  );
}
