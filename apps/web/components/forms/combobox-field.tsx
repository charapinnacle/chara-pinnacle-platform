"use client";

import type { FieldPath, FieldValues } from "react-hook-form";
import { Combobox } from "@/components/forms/combobox";
import { FormField } from "@/components/forms/form-field";
import type { ComboboxOption } from "@/lib/combobox";

type ComboboxFieldProps<T extends FieldValues, N extends FieldPath<T>> = Omit<
  React.ComponentProps<typeof FormField<T, N>>,
  "children"
> & {
  placeholder: string;
  options: readonly ComboboxOption[];
  emptyText?: string;
  freeText?: boolean;
  noScriptSelect?: boolean;
};

export function ComboboxField<T extends FieldValues, N extends FieldPath<T>>({
  placeholder,
  options,
  emptyText = "No match",
  freeText = false,
  noScriptSelect = false,
  ...fieldProps
}: ComboboxFieldProps<T, N>) {
  return (
    <FormField {...fieldProps}>
      {({ ref, value, ...controlProps }) => (
        <Combobox
          {...controlProps}
          label={fieldProps.label}
          placeholder={placeholder}
          inputRef={ref}
          value={String(value ?? "")}
          options={options}
          emptyText={emptyText}
          freeText={freeText}
          noScriptSelect={noScriptSelect}
        />
      )}
    </FormField>
  );
}
