"use client";

import { useId } from "react";
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const controlClassName =
  "bg-card px-3.5 text-base text-foreground hover:border-muted-foreground focus-visible:ring-0 aria-invalid:ring-0 aria-invalid:hover:border-destructive md:text-base";

type ControlProps<T extends FieldValues, N extends FieldPath<T>> =
  ControllerRenderProps<T, N> & {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  };

type FormFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  label: string;
  description?: string;
  children: (props: ControlProps<T, N>) => React.ReactNode;
};

export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  label,
  description,
  children,
}: FormFieldProps<T, N>) {
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
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {children({
              ...field,
              id,
              "aria-invalid": fieldState.invalid,
              "aria-describedby": describedBy,
            })}
            {description ? (
              <FieldDescription id={descriptionId} className={fieldState.error ? "sr-only" : undefined}>
                {description}
              </FieldDescription>
            ) : null}
            <FieldError id={errorId} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

type InputFieldProps<T extends FieldValues, N extends FieldPath<T>> = Omit<
  FormFieldProps<T, N>,
  "children"
> &
  Pick<React.ComponentProps<"input">, "type" | "autoComplete" | "inputMode" | "readOnly" | "maxLength">;

export function InputField<T extends FieldValues, N extends FieldPath<T>>({
  type,
  autoComplete,
  inputMode,
  readOnly,
  maxLength,
  ...fieldProps
}: InputFieldProps<T, N>) {
  return (
    <FormField {...fieldProps}>
      {(controlProps) => (
        <Input
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          readOnly={readOnly}
          maxLength={maxLength}
          className={cn("h-11", controlClassName)}
          {...controlProps}
        />
      )}
    </FormField>
  );
}

export function TextareaField<T extends FieldValues, N extends FieldPath<T>>(
  props: Omit<FormFieldProps<T, N>, "children">,
) {
  return (
    <FormField {...props}>
      {(controlProps) => <Textarea className={controlClassName} {...controlProps} />}
    </FormField>
  );
}
