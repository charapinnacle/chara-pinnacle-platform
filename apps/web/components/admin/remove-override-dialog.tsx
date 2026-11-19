"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { removeLimitOverride } from "@/lib/actions/plan-editor";
import { removeOverrideFormSchema, type RemoveOverrideForm } from "@/lib/validation/plan-editor";

type RemoveOverrideProps = { organizationId: string; organizationName: string; limitKey: string; limitLabel: string };

const FAILURE = "The override was not removed";

// Removes an override; the plan limit applies again at once (FR-R2, states Active -> Removed).
export function RemoveOverrideDialog(props: RemoveOverrideProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        Remove<span className="sr-only"> the {props.limitLabel.toLowerCase()} override of {props.organizationName}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Remove an override">
        <RemoveForm {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function RemoveForm({ organizationId, organizationName, limitKey, limitLabel, onClose }: RemoveOverrideProps & { onClose: () => void }) {
  const router = useRouter();
  const form = useForm<RemoveOverrideForm>({ resolver: zodResolver(removeOverrideFormSchema), defaultValues: { reason: "" }, shouldFocusError: true });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const reasonId = `remove-override-${limitKey}-reason`;

  function onSubmit(values: RemoveOverrideForm) {
    return submit(
      () => removeLimitOverride({ organizationId, limitKey, reason: values.reason }),
      (result) => {
        if (result.message) toastError(FAILURE, result.message);
        if (!result.done) return;
        onClose();
        toast({ title: "The override is removed" });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-body">
        {limitLabel} of {organizationName}. The plan limit applies again at once.
      </p>
      <FormErrorSummary form={form} ids={{ reason: reasonId }} />
      <TextareaField control={control} name="reason" id={reasonId} label="Reason for the change" description="Required, 10 to 500 characters." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant="destructive" busy={formState.isSubmitting}>
          Remove override
        </FormButton>
      </div>
    </form>
  );
}
