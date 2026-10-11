"use client";

import { Check, type LucideIcon } from "lucide-react";
import { useId } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { FieldMessage } from "@/components/forms/field-message";
import { FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

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

// A choice between a few options as equal cards: the chosen one gets a near-black border and a check in its round
// indicator (the radio, 20 px with a 1.5 px neutral border), the others stay white. The native radio covers its card, so the
// whole card is the target and the arrow keys move the choice.
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
            className="group/set gap-3"
          >
            <FieldLegend variant="label" className="mb-1.5">
              {legend}
            </FieldLegend>
            {description ? (
              <p id={descriptionId} className="text-small leading-normal text-muted-foreground">
                {description}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((option, index) => {
                const optionId = index === 0 ? id : `${id}-${option.value}`;
                const optionDescriptionId = `${optionId}-description`;
                const Icon = option.icon;
                return (
                  <div
                    key={option.value}
                    className="group/option relative grid grid-cols-[1fr_auto] content-start gap-x-3 gap-y-1.5 rounded-xl border border-input bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground has-checked:border-primary has-checked:hover:border-primary has-checked:ring-1 has-checked:ring-primary has-checked:ring-inset group-data-[invalid=true]/set:border-destructive"
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
                    <FieldLabel
                      htmlFor={optionId}
                      className="items-center gap-2.5 text-body font-medium text-foreground"
                    >
                      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground transition-colors duration-120 group-has-checked/option:text-foreground" />
                      {option.label}
                    </FieldLabel>
                    <span
                      aria-hidden
                      className="grid size-5 place-items-center rounded-full border-[1.5px] border-input bg-card transition-colors duration-120 group-hover/option:border-muted-foreground group-has-checked/option:border-primary group-has-checked/option:bg-primary group-data-[invalid=true]/set:border-destructive"
                    >
                      <Check
                        strokeWidth={3}
                        className="size-3 scale-75 text-primary-foreground opacity-0 transition-[opacity,scale] duration-120 group-has-checked/option:scale-100 group-has-checked/option:opacity-100 motion-reduce:transition-none"
                      />
                    </span>
                    {option.description ? (
                      <p id={optionDescriptionId} className="col-span-full text-small leading-normal text-muted-foreground">
                        {option.description}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <FieldMessage id={errorId} error={fieldState.error} />
          </FieldSet>
        );
      }}
    />
  );
}
