"use client";

import type { FieldPath, FieldValues } from "react-hook-form";
import { FormField } from "@/components/forms/form-field";
import { selectClassName } from "@/components/forms/select-class";

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
          className={selectClassName}
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
