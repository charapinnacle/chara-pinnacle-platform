"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldContent, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

type Option = { value: string; label: string };

type CheckboxGroupFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  legend: string;
  options: readonly Option[];
};

// One checkbox per option; the value of the field is the array of the values that are ticked.
export function CheckboxGroupField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  legend,
  options,
}: CheckboxGroupFieldProps<T, N>) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected: string[] = field.value;
        return (
          <FieldSet id={id} className="gap-1" data-invalid={fieldState.invalid}>
            <FieldLegend variant="label" className="mb-0 text-base">
              {legend}
            </FieldLegend>
            {options.map((option, index) => {
              const optionId = `${id}-${option.value}`;
              return (
                <Field
                  key={option.value}
                  orientation="horizontal"
                  className="relative items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-card sm:p-3"
                >
                  <span className="relative z-10 mt-px grid size-5 shrink-0 place-items-center">
                    <input
                      type="checkbox"
                      id={optionId}
                      ref={index === 0 ? field.ref : undefined}
                      name={field.name}
                      checked={selected.includes(option.value)}
                      onChange={(event) =>
                        field.onChange(
                          event.target.checked
                            ? [...selected, option.value]
                            : selected.filter((value) => value !== option.value),
                        )
                      }
                      onBlur={field.onBlur}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={fieldState.error ? errorId : undefined}
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
                      htmlFor={optionId}
                      className="cursor-pointer text-body font-normal leading-snug text-pretty text-foreground break-words before:absolute before:inset-0"
                    >
                      {option.label}
                    </FieldLabel>
                  </FieldContent>
                </Field>
              );
            })}
            <FieldError id={errorId} errors={[fieldState.error]} />
          </FieldSet>
        );
      }}
    />
  );
}
