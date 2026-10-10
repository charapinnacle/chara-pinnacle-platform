import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { ErrorSummary } from "@/components/forms/error-summary";
import { summaryItems } from "@/components/forms/summary-items";

type FormErrorSummaryProps<TValues extends FieldValues, TContext, TOutput> = {
  form: UseFormReturn<TValues, TContext, TOutput>;
  // The input id of each field that can have an error, in the order the summary lists them.
  ids: Partial<Record<FieldPath<TValues>, string>>;
  // The ref that useServerFormSubmit moves focus to after a submit; leave it out when focus goes to the first invalid field.
  summaryRef?: React.Ref<HTMLDivElement>;
  action?: React.ReactNode;
};

// The one error summary of a form: the field errors, each linked to its input, then the refusal the server gave for the form.
export function FormErrorSummary<TValues extends FieldValues, TContext, TOutput>({
  form,
  ids,
  summaryRef,
  action,
}: FormErrorSummaryProps<TValues, TContext, TOutput>) {
  return (
    <ErrorSummary
      ref={summaryRef}
      items={summaryItems(form.formState.errors, ids)}
      onSelect={(key) => form.setFocus(key as FieldPath<TValues>)}
      action={action}
    />
  );
}
