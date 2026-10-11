"use client";

import { useId } from "react";
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { controlClassName } from "@/components/forms/control-class";
import { FieldMessage } from "@/components/forms/field-message";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// The field lays out its children at full width, which beats the 1px of sr-only, and a long description that does not wrap
// then widens the page on a phone.
const SR_ONLY_WIDTH = "sr-only w-px!";

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
  // The label stays in the page for assistive technology and leaves it for the eye: a control that says what it is by its
  // placeholder or its first option (a search bar, a row of filters).
  hideLabel?: boolean;
  description?: string;
  children: (props: ControlProps<T, N>) => React.ReactNode;
};

export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  label,
  hideLabel,
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
          <Field data-invalid={fieldState.invalid} className="data-[invalid=true]:text-foreground">
            <FieldLabel htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
              {label}
            </FieldLabel>
            {children({
              ...field,
              id,
              "aria-invalid": fieldState.invalid,
              "aria-describedby": describedBy,
            })}
            {description ? (
              <p
                id={descriptionId}
                className={cn("-mt-0.5 text-small leading-normal text-muted-foreground", fieldState.error && SR_ONLY_WIDTH)}
              >
                {description}
              </p>
            ) : null}
            <FieldMessage id={errorId} error={fieldState.error} className="-mt-0.5 flex items-start gap-1.5 text-small leading-snug" />
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
  Pick<React.ComponentProps<"input">, "type" | "autoComplete" | "inputMode" | "readOnly" | "maxLength" | "placeholder">;

export function InputField<T extends FieldValues, N extends FieldPath<T>>({
  type,
  autoComplete,
  inputMode,
  readOnly,
  maxLength,
  placeholder,
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
          placeholder={placeholder}
          className={cn("h-12", controlClassName, readOnly && "bg-muted")}
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
