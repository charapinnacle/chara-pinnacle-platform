"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { withdrawSubmission } from "@/lib/actions/submissions";

type WithdrawSubmissionProps = { submissionId: string; title: string };

// The candidate withdraws an approved submission at any stage (FR-O4 step Withdraw, AC9), after a confirmation: the
// employer loses access to the shared documents at once.
export function WithdrawSubmission({ submissionId, title }: WithdrawSubmissionProps) {
  const [open, setOpen] = useState(false);
  const withdraw = useActionCall("The submission was not withdrawn");
  const close = () => setOpen(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={() => setOpen(true)}>
        Withdraw submission
      </FormButton>
      <ModalDialog open={open} onClose={close} title="Withdraw this submission?">
        <p className="text-body leading-relaxed wrap-anywhere">Your submission for {title}.</p>
        <p className="text-body leading-relaxed">
          The employer loses access to your profile and documents immediately. This cannot be undone.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            variant="destructive"
            busy={withdraw.pending}
            onClick={() => withdraw.run(() => withdrawSubmission(submissionId), "Submission withdrawn", close)}
          >
            {withdraw.pending ? "Withdrawing" : "Withdraw"}
          </FormButton>
        </div>
      </ModalDialog>
    </>
  );
}
