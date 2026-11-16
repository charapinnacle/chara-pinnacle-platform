"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { acceptCommitment, acceptUpdatedCommitment } from "@/lib/actions/commitment";
import { COMMITMENT_LABEL, commitmentSchema, type CommitmentInput } from "@/lib/validation/commitment";

type CommitmentFormProps = {
  slug: string;
  // The version the page shows; the database refuses it once a newer one is published.
  version: number;
  // Past onboarding the page stays: the caller is told once the acceptance is recorded.
  onAccepted?: () => void;
};

const FAILURE_TITLE = "Could not accept the commitment";
const ids = { confirmed: "commitment-confirmed" } as const;

// The owner's confirmation of the employer-pays commitment (FR-J3 AC1): one box of its own, never ticked in advance. A
// refused submit moves the focus to the box, whose message sits next to it, rather than to the summary.
export function CommitmentForm({ slug, version, onAccepted }: CommitmentFormProps) {
  const form = useForm<CommitmentInput>({
    resolver: zodResolver(commitmentSchema),
    defaultValues: { confirmed: false },
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });

  function onSubmit() {
    return submit(
      () => (onAccepted ? acceptUpdatedCommitment : acceptCommitment)(slug, version, form.getValues()),
      (result) => {
        if (result.message) toastError(FAILURE_TITLE, result.message);
        if (result.accepted) onAccepted?.();
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} ids={ids} />
      <CheckboxField control={control} name="confirmed" id={ids.confirmed}>
        {COMMITMENT_LABEL}
      </CheckboxField>
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : onAccepted ? "Accept the commitment" : "Accept and continue"}
      </FormButton>
    </form>
  );
}
