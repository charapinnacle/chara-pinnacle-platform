"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { withdrawMyResponse } from "@/lib/actions/responses";
import { WITHDRAWAL_REASON_MAX, withdrawFormSchema, type WithdrawFormInput, type WithdrawFormOutput } from "@/lib/validation/response";

const REASON_ID = "withdraw-reason";

type WithdrawResponseProps = { slug: string; responseId: string };

// Withdraw a live response (FR-N2 step Withdraw, AC8; FR-O2 step Withdraw), after a confirmation with an optional reason
// the employer reads. Final: the response still counts this month and cannot be sent again.
export function WithdrawResponse({ slug, responseId }: WithdrawResponseProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        Withdraw response
      </FormButton>
      <ModalDialog open={open} onClose={close} title="Withdraw this response?">
        <WithdrawForm slug={slug} responseId={responseId} onClose={close} />
      </ModalDialog>
    </>
  );
}

function WithdrawForm({ slug, responseId, onClose }: WithdrawResponseProps & { onClose: () => void }) {
  const form = useForm<WithdrawFormInput, undefined, WithdrawFormOutput>({
    resolver: zodResolver(withdrawFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The response was not withdrawn" });
  const length = useWatch({ control, name: "reason" }).length;

  function onSubmit(values: WithdrawFormOutput) {
    return submit(
      () => withdrawMyResponse(slug, responseId, values),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "Response withdrawn" });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: REASON_ID }} />
      <p className="text-body leading-relaxed">
        The employer sees that you withdrew it. This is final: the response still counts against this month&apos;s responses and
        your company cannot respond to this job order again.
      </p>
      <TextareaField
        control={control}
        name="reason"
        id={REASON_ID}
        label="Reason (optional)"
        description={`The employer reads the reason. ${length}/${WITHDRAWAL_REASON_MAX}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant="destructive" busy={formState.isSubmitting}>
          Withdraw response
        </FormButton>
      </div>
    </form>
  );
}
