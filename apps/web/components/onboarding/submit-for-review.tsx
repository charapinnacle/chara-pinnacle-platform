"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { submitForReview } from "@/lib/actions/partner-review";
import { RESUBMIT_LABEL, resubmitSchema, type ResubmitInput } from "@/lib/validation/partner-review";

const FAILURE_TITLE = "Could not submit your company for review";
const ids = { checked: "resubmit-checked" } as const;

type SubmitForReviewProps = {
  slug: string;
  // After a request for information: the partner confirms the change first (FR-J4 AC7).
  again?: boolean;
};

// The button of the Ready step (FR-J1 AC10). The button stays disabled while the request runs, so a double click submits
// once (the database serialises submissions as well); a refusal is said in the error summary and in a toast.
export function SubmitForReview({ slug, again = false }: SubmitForReviewProps) {
  const form = useForm<ResubmitInput>({
    resolver: zodResolver(resubmitSchema(again)),
    defaultValues: { checked: false },
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });

  function onSubmit() {
    return submit(
      () => submitForReview(slug, form.getValues()),
      (result) => {
        if (result.message) toastError(FAILURE_TITLE, result.message);
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} ids={ids} summaryRef={summaryRef} />
      {again ? (
        <CheckboxField control={control} name="checked" id={ids.checked}>
          {RESUBMIT_LABEL}
        </CheckboxField>
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Submitting..." : again ? "Submit again for review" : "Submit for review"}
      </FormButton>
    </form>
  );
}
