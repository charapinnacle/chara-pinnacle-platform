"use client";

import type { FieldPath, FieldValues } from "react-hook-form";
import { FormField } from "@/components/forms/form-field";

type SelectFieldProps<T extends FieldValues, N extends FieldPath<T>> = Omit<
  React.ComponentProps<typeof FormField<T, N>>,
  "children"
> & {
  placeholder: string;
  options: readonly { value: string; label: string }[];
};

// A native select: it keeps the keyboard type-ahead and the mobile pickers, which matter for a list of 250 countries.
export function SelectField<T extends FieldValues, N extends FieldPath<T>>({
  placeholder,
  options,
  ...fieldProps
}: SelectFieldProps<T, N>) {
  return (
    <FormField {...fieldProps}>
      {(controlProps) => (
        <select
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground transition-colors hover:border-muted-foreground aria-invalid:border-destructive"
          {...controlProps}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
