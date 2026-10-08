"use client";

import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

type RadioOption = { value: string; label: string; icon: LucideIcon; description?: string };

type RadioGroupFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id?: string;
  legend: string;
  description?: string;
  options: readonly RadioOption[];
  onValueChange?: (value: string) => void;
};

export function RadioGroupField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id: idProp,
  legend,
  description,
  options,
  onValueChange,
}: RadioGroupFieldProps<T, N>) {
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
          <FieldSet
            role="radiogroup"
            aria-describedby={describedBy}
            aria-invalid={fieldState.invalid}
            data-invalid={fieldState.invalid}
            className="group/set gap-3 data-[invalid=true]:text-destructive"
          >
            <FieldLegend variant="label">{legend}</FieldLegend>
            {description ? (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            ) : null}
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              {options.map((option, index) => {
                const optionId = index === 0 ? id : `${id}-${option.value}`;
                const optionDescriptionId = `${optionId}-description`;
                const Icon = option.icon;
                return (
                  <div
                    key={option.value}
                    className="group/option relative grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-4 rounded-xl border border-input bg-card p-4 transition-[border-color,box-shadow] hover:border-muted-foreground has-checked:border-primary has-checked:bg-accent has-checked:ring-1 has-checked:ring-primary has-checked:ring-inset has-focus-visible:shadow-focus group-data-[invalid=true]/set:border-destructive sm:grid-cols-[1fr_auto] sm:items-start"
                  >
                    <input
                      type="radio"
                      id={optionId}
                      ref={index === 0 ? field.ref : undefined}
                      name={field.name}
                      value={option.value}
                      checked={field.value === option.value}
                      onChange={() => {
                        field.onChange(option.value);
                        onValueChange?.(option.value);
                      }}
                      onBlur={field.onBlur}
                      aria-describedby={option.description ? optionDescriptionId : undefined}
                      className="absolute inset-0 size-full cursor-pointer appearance-none rounded-xl"
                    />
                    <span
                      aria-hidden
                      className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-has-checked/option:bg-card group-has-checked/option:text-primary sm:col-start-1 sm:row-start-1"
                    >
                      <Icon className="size-5" />
                    </span>
                    <FieldLabel
                      htmlFor={optionId}
                      className="text-body font-medium text-foreground sm:col-span-2 sm:row-start-2"
                    >
                      {option.label}
                    </FieldLabel>
                    <span
                      aria-hidden
                      className="size-5 rounded-full border-2 border-input bg-card transition-[border-width,border-color] group-has-checked/option:border-[6px] group-has-checked/option:border-primary sm:col-start-2 sm:row-start-1"
                    />
                    {option.description ? (
                      <FieldDescription id={optionDescriptionId} className="col-span-full sm:row-start-3">
                        {option.description}
                      </FieldDescription>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <FieldError id={errorId} errors={[fieldState.error]} />
          </FieldSet>
        );
      }}
    />
  );
}
